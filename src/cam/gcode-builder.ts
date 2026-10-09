import { Box, GcodeOptions, resolveGcodeOptions } from './gcode-options';
import { fitArcs } from './arc-fit';
import { arcOf, polygonsBounds, segmentPoints } from './arcs';
import {
  distanceToAxis,
  isTurned,
  wrapDirection,
  onBlank,
  rotaryClearance,
  rotaryShift,
} from './rotary';
import { CamPath, CamPoint, CamPoint3 } from './types';

export class GCodeBuilder {
  private _instructions: PathInstruction[] = [];
  private _isAtSafetyHeight = false;

  /** A builder of `instructions` (as `instructions` gives them). */
  static of(
    instructions: readonly PathInstruction[],
    isAtSafetyHeight: boolean,
  ): GCodeBuilder {
    const builder = new GCodeBuilder();
    builder._instructions = [...instructions];
    builder._isAtSafetyHeight = isAtSafetyHeight;
    return builder;
  }

  static clone(a: GCodeBuilder): GCodeBuilder {
    const cloned = new GCodeBuilder();
    cloned._instructions = [...a._instructions];
    cloned._isAtSafetyHeight = a._isAtSafetyHeight;
    return cloned;
  }

  /**
   * A compact copy for sending between threads: the moves (nearly all of
   * the instructions) go into typed arrays, which copy or transfer far
   * faster than one object per move.
   */
  static pack(builder: GCodeBuilder): PackedGCode {
    const ops: number[] = [];
    const nums: number[] = [];
    const other: PathInstruction[] = [];
    for (const i of builder._instructions) {
      switch (i.type) {
        case 'travel':
          ops.push(PackedOp.Travel);
          nums.push(i.to.x, i.to.y);
          break;
        case 'carve':
          if (i.bulge) {
            ops.push(PackedOp.Arc);
            nums.push(i.to.x, i.to.y, i.z ?? NaN, i.bulge);
          } else {
            ops.push(PackedOp.Carve);
            nums.push(i.to.x, i.to.y, i.z ?? NaN);
          }
          break;
        case 'plunge':
          ops.push(PackedOp.Plunge);
          nums.push(i.depth);
          break;
        default:
          ops.push(PackedOp.Other);
          other.push(i);
      }
    }
    return {
      packedGCode: true,
      ops: Uint8Array.from(ops),
      nums: Float64Array.from(nums),
      other,
      isAtSafetyHeight: builder._isAtSafetyHeight,
    };
  }

  static unpack(packed: PackedGCode): GCodeBuilder {
    const builder = new GCodeBuilder();
    const { ops, nums, other } = packed;
    const instructions: PathInstruction[] = new Array(ops.length);
    let n = 0;
    let o = 0;
    for (let k = 0; k < ops.length; k++) {
      switch (ops[k]) {
        case PackedOp.Travel:
          instructions[k] = {
            type: 'travel',
            to: { x: nums[n], y: nums[n + 1] },
          };
          n += 2;
          break;
        case PackedOp.Carve: {
          const z = nums[n + 2];
          instructions[k] = {
            type: 'carve',
            to: { x: nums[n], y: nums[n + 1] },
            z: Number.isNaN(z) ? undefined : z,
          };
          n += 3;
          break;
        }
        case PackedOp.Arc: {
          const z = nums[n + 2];
          instructions[k] = {
            type: 'carve',
            to: { x: nums[n], y: nums[n + 1] },
            z: Number.isNaN(z) ? undefined : z,
            bulge: nums[n + 3],
          };
          n += 4;
          break;
        }
        case PackedOp.Plunge:
          instructions[k] = { type: 'plunge', depth: nums[n] };
          n += 1;
          break;
        default:
          instructions[k] = other[o++];
      }
    }
    builder._instructions = instructions;
    builder._isAtSafetyHeight = packed.isAtSafetyHeight;
    return builder;
  }

  /**
   * The XY extent of the cuts (where the tool's centre goes while cutting
   * or drilling; not travel), or null without any.
   */
  cutBounds(): Box | null {
    let box: Box | null = null;
    const add = (p: CamPoint | null) => {
      if (!p) return;
      box ??= { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x);
      box.maxY = Math.max(box.maxY, p.y);
    };
    let at: CamPoint | null = null;
    for (const i of this._instructions) {
      switch (i.type) {
        case 'travel':
          at = i.to;
          break;
        case 'plunge':
          add(at);
          break;
        case 'carve':
          add(at);
          add(i.to);
          if (i.bulge && at) {
            // An arc reaches past its ends where it passes an axis.
            const box = polygonsBounds([
              { vertices: [{ ...at, bulge: i.bulge }, i.to], close: false },
            ]);
            add({ x: box.minX, y: box.minY });
            add({ x: box.maxX, y: box.maxY });
          }
          at = i.to;
          break;
        case 'drill-cycle':
          at = { x: i.x, y: i.y };
          add(at);
          break;
      }
    }
    return box;
  }

  /** What was recorded, in order (to rewrite it; see `of`). */
  get instructions(): readonly PathInstruction[] {
    return this._instructions;
  }

  get isAtSafetyHeight() {
    return this._isAtSafetyHeight;
  }

  goToSafeHeight() {
    this._instructions.push({ type: 'safety-height' });
    this._isAtSafetyHeight = true;
    return this;
  }

  plunge(depth: number) {
    this._instructions.push({ type: 'plunge', depth });
    this._isAtSafetyHeight = false;
    return this;
  }

  travelTo(x: number, y: number) {
    this._instructions.push({ type: 'travel', to: { x, y } });
    return this;
  }

  carveTo(x: number, y: number, z?: number) {
    this._instructions.push({ type: 'carve', to: { x, y }, z });
    return this;
  }

  /**
   * An arc from where the tool is to (x, y): `bulge` is tan(sweep / 4),
   * positive counter-clockwise (see `src/cam/arcs.ts`); 0 is a line. With
   * `z`, the height changes evenly along it (a helix).
   */
  arcTo(x: number, y: number, bulge: number, z?: number) {
    this._instructions.push(
      bulge
        ? { type: 'carve', to: { x, y }, z, bulge }
        : { type: 'carve', to: { x, y }, z },
    );
    return this;
  }

  sourceShapeId(id: string) {
    this._instructions.push({ type: 'source-shape', id });
    return this;
  }

  /** Tag what follows with the operation that produced it (empty to clear). */
  sourceOperationId(id: string) {
    this._instructions.push({ type: 'source-operation', id });
    return this;
  }

  /** The cutting feed for what follows; empty means the G-code default. */
  carveFeedrate(feedRate?: number | null) {
    this._instructions.push({
      type: 'carve-feedrate',
      feedRate: feedRate ?? null,
    });
    return this;
  }

  /** The plunge feed for what follows; empty means the G-code default. */
  plungeFeedRate(feedRate?: number | null) {
    this._instructions.push({
      type: 'plunge-feedrate',
      feedRate: feedRate ?? null,
    });
    return this;
  }

  addModelMetadata(model: string) {
    this._instructions.push({ type: 'model', model });
    return this;
  }

  /** A comment line (`; text`), e.g. a note for whoever runs the job. */
  comment(text: string) {
    this._instructions.push({ type: 'comment', text });
    return this;
  }

  stopProgram() {
    this._instructions.push({ type: 'stop-program' });
    return this;
  }

  /**
   * The tool for what follows. When the program is built, a tool change
   * (retract, then `T<n> M6`) is emitted wherever the tool differs from the
   * previous one, and for the first tool so it's loaded before cutting.
   */
  useTool(toolNumber: number, label: string, spindleSpeed?: number) {
    this._instructions.push({ type: 'tool', toolNumber, label, spindleSpeed });
    return this;
  }

  pause() {
    this._instructions.push({ type: 'pause' });
    return this;
  }

  /** A rapid move straight up or down to `z` (above the work, or into a
   * hole already drilled). */
  rapidZ(z: number) {
    this._instructions.push({ type: 'rapid-z', z });
    this._isAtSafetyHeight = false;
    return this;
  }

  /**
   * Turn the stock on the rotary axis to `angle` (degrees) for what
   * follows, at safe height: what follows is in its frame (see
   * `rotary.ts`). Nothing without a rotary axis (`GcodeOptions.rotary`).
   *
   * With `wrap` (round stock only), what follows is wrapped round it: drawn
   * unrolled, its position across the axis (Y along X, X along Y) runs
   * round the circumference from `angle`, the axis line at `angle`, and Z
   * is the depth below the surface. Each move turns the axis as it goes.
   */
  rotate(angle: number, wrap = false) {
    this._instructions.push(
      wrap ? { type: 'rotate', angle, wrap } : { type: 'rotate', angle },
    );
    return this;
  }

  /** Wait `seconds` (G4), e.g. at the bottom of a hole. */
  dwell(seconds: number) {
    this._instructions.push({ type: 'dwell', seconds });
    return this;
  }

  /**
   * One hole as a canned drilling cycle (G81/G82/G83/G73), for controllers
   * that have them; starts and ends at safe height. The preview shows it as
   * the moves the controller makes.
   */
  drillCycle(cycle: DrillCycle) {
    this._instructions.push({ type: 'drill-cycle', ...cycle });
    this._isAtSafetyHeight = true;
    return this;
  }

  /** All of `builders`, one after another, in one copy. */
  static concatAll(builders: GCodeBuilder[]): GCodeBuilder {
    const result = new GCodeBuilder();
    result._instructions = ([] as PathInstruction[]).concat(
      ...builders.map((b) => b._instructions),
    );
    result._isAtSafetyHeight =
      builders[builders.length - 1]?._isAtSafetyHeight ?? false;
    return result;
  }

  concat(other: GCodeBuilder): GCodeBuilder {
    const result = new GCodeBuilder();
    result._instructions = this._instructions.concat(other._instructions);
    result._isAtSafetyHeight = other._isAtSafetyHeight;
    return result;
  }

  build(options: Partial<GcodeOptions> = {}): string {
    const o = resolveGcodeOptions(options);
    const reversed = o.rotaryReversed;
    const gcode: string[] = [];
    this.walk(
      options,
      {
        line: (text) => gcode.push(text),
        cycle: (text) => gcode.push(text),
        move: (code, changed) => {
          const coords: string[] = [];
          if (changed.x !== undefined) coords.push(`X${changed.x}`);
          if (changed.y !== undefined) coords.push(`Y${changed.y}`);
          if (changed.z !== undefined) coords.push(`Z${changed.z}`);
          if (changed.a !== undefined) {
            const a = (reversed ? -changed.a : changed.a) || 0;
            coords.push(`${o.rotaryAxis}${a}`);
          }
          if (changed.i !== undefined) coords.push(`I${changed.i}`);
          if (changed.j !== undefined) coords.push(`J${changed.j}`);
          if (changed.feed !== undefined) coords.push(`F${changed.feed}`);
          gcode.push(`${code} ${coords.join(' ')}`);
        },
      },
      o.arcs,
    );
    return gcode.join('\n');
  }

  /**
   * The moves the G-code makes, as paths for the preview: what parsing
   * `build(options)` back would give, without writing the text. A new path
   * starts whenever the move type or the source shape/operation changes;
   * cuts carry each move's feed rate.
   *
   * With the stock turned on a rotary axis, paths are in their operation's
   * frame (Z from the top as turned) and say how far it's turned
   * (`rotation`); turning it is a travel round the axis, drawn on the blank
   * at 0°.
   */
  toPaths(options: Partial<GcodeOptions> = {}): CamPath[] {
    const o = resolveGcodeOptions(options);
    const paths: CamPath[] = [];
    let path: CamPath | null = null;
    let sourceShapeId = 'unknown';
    let sourceOperationId: string | undefined = undefined;
    // Where the tool is, as the machine moves (Z from the top at 0°).
    let last: CamPoint3 & { a?: number; turns?: number } = { x: 0, y: 0, z: 0 };
    let feed = o.carveFeedRate;
    let rotation = 0;
    let shift = 0;
    let wrapping = false;
    const rotary = o.rotary;
    /** A point the machine reaches, in the operation's frame. */
    const local = (
      p: CamPoint3 & { a?: number; turns?: number },
    ): CamPoint3 => {
      if (wrapping && rotary) {
        // Unrolled: the angle back to a position across the axis.
        const across =
          rotary.across +
          wrapDirection(rotary) *
            ((p.a ?? 0) - (p.turns ?? 0) - rotation) *
            (Math.PI / 180) *
            rotary.halfThickness;
        return rotary.along === 'x'
          ? { x: p.x, y: across, z: p.z }
          : { x: across, y: p.y, z: p.z };
      }
      return shift
        ? { x: p.x, y: p.y, z: p.z - shift }
        : { x: p.x, y: p.y, z: p.z };
    };
    /** Wrapped moves split so their lines follow the surface. */
    const wrapStep = rotary
      ? Math.max(0.5, rotary.halfThickness * ((3 * Math.PI) / 180))
      : Infinity;

    this.walk(options, {
      line: () => {},
      source: (kind, id) => {
        if (kind === 'shape') sourceShapeId = id;
        else sourceOperationId = id || undefined;
      },
      rotate: (angle, newShift, wrap, fromA, toA) => {
        if (path) paths.push(path);
        path = null;
        if (rotary && toA !== fromA) {
          // The turn itself, round the axis where the bit is.
          const steps = Math.max(1, Math.ceil(Math.abs(toA - fromA) / 5));
          const points: CamPoint3[] = [];
          for (let k = 0; k <= steps; k++) {
            const turned = fromA + ((toA - fromA) * k) / steps;
            points.push(onBlank(rotary, turned, last));
          }
          paths.push({
            points,
            sourceShapeId,
            sourceOperationId,
            type: 'travel',
          });
        }
        rotation = angle;
        shift = newShift;
        wrapping = wrap;
      },
      move: (code, changed, at) => {
        if (
          changed.x === undefined &&
          changed.y === undefined &&
          changed.z === undefined &&
          changed.feed === undefined
        ) {
          // Only turning (drawn by `rotate`).
          return;
        }
        if (changed.speed !== undefined) feed = changed.speed;
        else if (changed.feed !== undefined) feed = changed.feed;
        const type = code === 'G0' ? 'travel' : 'carve';
        if (
          !path ||
          type !== path.type ||
          sourceShapeId !== path.sourceShapeId ||
          sourceOperationId !== path.sourceOperationId
        ) {
          if (path) paths.push(path);
          path = {
            // Unrolled as the move's end is (see below).
            points: [local({ ...last, turns: at.turns })],
            sourceShapeId,
            sourceOperationId,
            type,
          };
          if (wrapping) {
            path.wrapped = true;
            path.rotation = rotation;
          } else if (isTurned(rotation)) {
            path.rotation = rotation;
          }
          if (type === 'carve') path.feeds = [feed];
        }
        // Both ends unrolled with the end's whole turns: the same place on
        // the stock, and the move then goes the way the axis turns.
        const from = local({ ...last, turns: at.turns });
        if (wrapping && last.turns !== at.turns && path.points.length > 1) {
          // Where it was, unrolled as it goes on (the same place).
          path.points.push(from);
          path.feeds?.push(feed);
        }
        last = { x: at.x, y: at.y, z: at.z, a: at.a, turns: at.turns };
        const to = local(last);
        // Wrapped, a move is straight in the unrolled surface, not in
        // space: points along it, for the preview to wrap.
        const pieces = wrapping
          ? Math.min(
              1000,
              Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / wrapStep),
            )
          : 1;
        for (let k = 1; k <= pieces; k++) {
          const t = k / pieces;
          path.points.push(
            k === pieces
              ? to
              : {
                  x: from.x + (to.x - from.x) * t,
                  y: from.y + (to.y - from.y) * t,
                  z: from.z + (to.z - from.z) * t,
                },
          );
          path.feeds?.push(feed);
        }
      },
    });

    if (path) paths.push(path);
    return paths;
  }

  /**
   * Roughly how long the program takes: each move's length at its feed
   * (rapids at `rapidRate`), plus dwells and spindle waits. Acceleration
   * isn't counted, so short, jerky moves take longer than this.
   */
  estimateTime(options: Partial<GcodeOptions> = {}): JobTime {
    const o = resolveGcodeOptions(options);
    const byOperation = new Map<string, number>();
    let total = 0;
    let operation = '';
    let feed = o.carveFeedRate;
    let last: (CamPoint3 & { a?: number }) | null = null;
    let rotation = 0;
    const add = (seconds: number) => {
      total += seconds;
      byOperation.set(operation, (byOperation.get(operation) ?? 0) + seconds);
    };
    this.walk(o, {
      line: (text) => {
        const wait = /^G4 P([\d.]+)/.exec(text);
        if (wait) add(+wait[1]);
      },
      source: (kind, id) => {
        if (kind === 'operation') operation = id;
      },
      rotate: (angle, _shift, _wrap, fromA, toA) => {
        // Round the axis at the rapid speed, where the bit is.
        if (o.rotary && last && o.rapidRate > 0) {
          const radians = (Math.abs(toA - fromA) * Math.PI) / 180;
          const length = distanceToAxis(o.rotary, last) * radians;
          add((length / o.rapidRate) * 60);
        }
        rotation = angle;
      },
      move: (code, changed, at) => {
        if (changed.speed !== undefined) feed = changed.speed;
        else if (changed.feed !== undefined) feed = changed.feed;
        const turningOnly =
          changed.x === undefined &&
          changed.y === undefined &&
          changed.z === undefined;
        // Turning alone is counted by `rotate`.
        if (last && !turningOnly) {
          // Round the axis too, where the bit is (wrapped cuts).
          const da = ((at.a ?? 0) - (last.a ?? 0)) * (Math.PI / 180);
          const round =
            da && o.rotary
              ? distanceToAxis(o.rotary, {
                  x: (at.x + last.x) / 2,
                  y: (at.y + last.y) / 2,
                  z: (at.z + last.z) / 2,
                }) * da
              : 0;
          const length = Math.hypot(
            at.x - last.x,
            at.y - last.y,
            at.z - last.z,
            round,
          );
          const rate = code === 'G0' ? o.rapidRate : feed;
          if (rate > 0) add((length / rate) * 60);
        }
        last = at;
      },
    });
    return { total, byOperation };
  }

  /**
   * Walks the instructions as G-code, handing each line or move to `out`.
   * With `arcs`, runs of cuts along a circle become G2/G3 arcs.
   */
  private walk(options: Partial<GcodeOptions>, out: GcodeSink, arcs = false) {
    const o = resolveGcodeOptions(options);
    // Design coordinates to the G-code's (its zero on the stock, if set;
    // Z up by how much higher the top of the stock is as turned).
    const base = o.offset ?? { x: 0, y: 0, z: 0 };
    let off = base;
    const places = Math.max(0, Math.min(6, Math.round(o.decimals)));
    const factor = 10 ** places;
    const round = (v: number) => Math.round(v * factor) / factor;
    // Arc centres get more places: controllers check that the start and
    // end are the same distance from it.
    const centerFactor = 10 ** Math.max(places, 4);
    const roundCenter = (v: number) =>
      Math.round(v * centerFactor) / centerFactor;
    // How far an arc may stray from the cut it replaces: its points by
    // about what coordinates are rounded to anyway, between them by as much
    // as the cut itself strays from the curve it follows.
    const arcPoints = Math.max(0.005, 0.5 / factor);
    const arcTolerance = {
      points: arcPoints,
      chords: Math.max(arcPoints, o.curveTolerance),
    };
    const flushing: { push(text: string): void } = {
      push: (text) => {
        flushCuts();
        out.line(text);
      },
    };
    const gcode = arcs ? flushing : { push: out.line };

    // Cuts at one height and feed, held back until the run ends so arcs can
    // be fitted to them.
    let pendingCuts: CamPoint3[] = [];
    let pendingFeed = 0;

    // Tool changes only make sense with more than one tool, unless asked.
    const toolCount = new Set(
      this._instructions.flatMap((i) =>
        i.type === 'tool' ? [i.toolNumber] : [],
      ),
    ).size;
    const emitToolChanges =
      o.toolChange !== 'none' && !(o.skipSingleToolChange && toolCount <= 1);

    let x: number | null = null,
      y: number | null = null,
      z: number | null = null,
      feedRate: number | null = null,
      carveFeedRate = o.carveFeedRate,
      plungeFeedRate = o.plungeFeedRate,
      currentTool: number | null = null,
      spindleOn = false,
      // The current tool's own speed, if it has one; else the global one.
      spindleSpeed = o.spindleSpeed,
      runningSpeed: number | null = null;

    if (o.header) {
      gcode.push('G90 G21 G17 ; absolute, millimetres, XY plane');
    }

    // Started lazily before the first cut, and again after a tool change.
    const startSpindle = () => {
      if (o.spindle && !spindleOn) {
        gcode.push(`M3 S${Math.round(spindleSpeed)}`);
        runningSpeed = spindleSpeed;
        if (o.spindleDelay > 0) {
          gcode.push(`G4 P${round(o.spindleDelay)}`);
        }
        spindleOn = true;
      }
    };
    const stopSpindle = () => {
      if (spindleOn) {
        gcode.push('M5');
        spindleOn = false;
      }
    };

    // The stock on a rotary axis: how far it's turned (null until it is),
    // and safe height above its top at 0°, raised so the bit clears its
    // corners as it turns.
    const rotary = o.rotary ?? null;
    let angle: number | null = null;
    let a: number | null = null;
    const safeHeight = o.safetyHeight + (rotary ? rotaryClearance(rotary) : 0);
    /** Safe height in the frame of the stock as turned. */
    const safeZ = () => safeHeight - (off.z - base.z);
    // Wrapping round a round stock (see `rotate`), and the inverse-time
    // feed mode (G93) its cuts are written in, if asked.
    let wrap = false;
    let inverseTime = false;
    const leaveInverseTime = () => {
      if (inverseTime) {
        gcode.push('G94');
        inverseTime = false;
        // The controller's F is no feed rate now: write it again.
        feedRate = null;
      }
    };
    // Whole turns added to the angles written (wrapped cuts), so the axis
    // never turns further than it must between cuts.
    let turns = 0;
    /**
     * `to` (degrees) as the axis gets there the short way: the stock is the
     * same way up a whole turn either way, so the one nearest where it is.
     */
    const nearest = (to: number) =>
      a === null ? to : to + 360 * Math.round((a - to) / 360);
    /** Turns the stock to `to`; `exactly` there, not a whole turn off. */
    const turnTo = (to: number, wrapping = false, exactly = false) => {
      if (!rotary) return;
      const wrapNow = wrapping && rotary.round;
      const target = exactly ? to : nearest(to);
      if (to === angle && round(target) === a && wrapNow === wrap) return;
      leaveInverseTime();
      move('G0', { z: safeZ() });
      const from = a ?? 0;
      angle = to;
      wrap = wrapNow;
      turns = target - to;
      // Rounded, so Z in the operation's frame stays as it was rounded.
      const shift = round(rotaryShift(rotary, to));
      off = { ...base, z: base.z + shift };
      out.rotate?.(to, shift, wrap, from, target);
      move('G0', { a: target });
    };

    let cycleActive = false;
    for (const instruction of this._instructions) {
      // Canned cycles stay modal until cancelled.
      if (cycleActive && instruction.type !== 'drill-cycle') {
        cycleActive = false;
        out.line('G80');
      }
      switch (instruction.type) {
        case 'safety-height':
          flushCuts();
          move('G0', { z: safeZ() });
          break;

        case 'rotate':
          flushCuts();
          turnTo(instruction.angle, instruction.wrap);
          break;

        case 'plunge':
          flushCuts();
          startSpindle();
          move('G1', { z: instruction.depth }, plungeFeedRate);
          break;

        case 'travel':
          flushCuts();
          move('G0', instruction.to);
          break;

        case 'carve': {
          startSpindle();
          if (instruction.bulge && x !== null && y !== null && z !== null) {
            carveArc(instruction.to, instruction.z, instruction.bulge);
            break;
          }
          // Wrapped, a circle in the unrolled surface is no arc.
          if (arcs && !wrap && x !== null && y !== null && z !== null) {
            if (pendingCuts.length && pendingFeed !== carveFeedRate) {
              flushCuts();
            }
            pendingFeed = carveFeedRate;
            // Unchanged Z: wherever the cut before this one ended.
            const previous = pendingCuts[pendingCuts.length - 1];
            pendingCuts.push({
              ...instruction.to,
              z: instruction.z ?? previous?.z ?? z - off.z,
            });
          } else {
            flushCuts();
            move('G1', { ...instruction.to, z: instruction.z }, carveFeedRate);
          }
          break;
        }

        case 'source-shape':
          flushCuts();
          gcode.push(`; source-shape=${instruction.id}`);
          out.source?.('shape', instruction.id);
          break;

        case 'source-operation':
          gcode.push(`; source-operation=${instruction.id}`);
          out.source?.('operation', instruction.id);
          break;

        case 'carve-feedrate':
          carveFeedRate =
            instruction.feedRate && instruction.feedRate > 0
              ? instruction.feedRate
              : o.carveFeedRate;
          break;

        case 'plunge-feedrate':
          plungeFeedRate =
            instruction.feedRate && instruction.feedRate > 0
              ? instruction.feedRate
              : o.plungeFeedRate;
          break;

        case 'model':
          gcode.push(`; model=${instruction.model}`);
          break;

        case 'comment':
          gcode.push(`; ${instruction.text.replace(/[\r\n]+/g, ' ')}`);
          break;

        case 'stop-program':
          stopSpindle();
          // Turned back, ready for the next blank.
          // (Exactly 0, so the next job starts where it expects.)
          if (a) turnTo(0, false, true);
          leaveInverseTime();
          if (o.returnHome) {
            move('G0', { z: safeZ() });
            // The G-code's own zero.
            move('G0', { x: 0, y: 0 }, undefined, true);
          }
          gcode.push('M30');
          break;

        case 'pause':
          gcode.push('M00');
          break;

        case 'rapid-z':
          flushCuts();
          move('G0', { z: instruction.z });
          break;

        case 'dwell':
          gcode.push(`G4 P${round(instruction.seconds)}`);
          break;

        case 'drill-cycle':
          startSpindle();
          drill(instruction);
          break;

        case 'tool':
          // Also at the start, so the right tool is loaded before cutting.
          if (emitToolChanges && instruction.toolNumber !== currentTool) {
            move('G0', { z: safeZ() });
            stopSpindle();
            const name = `T${instruction.toolNumber} ${instruction.label}`;
            if (o.toolChange === 'm6') {
              gcode.push(`; tool change: ${name}`);
              gcode.push(`T${instruction.toolNumber} M6`);
            } else {
              gcode.push(`; insert ${name}, then resume`);
              gcode.push('M0');
            }
          }
          currentTool = instruction.toolNumber;

          spindleSpeed =
            instruction.spindleSpeed && instruction.spindleSpeed > 0
              ? instruction.spindleSpeed
              : o.spindleSpeed;
          // No tool change (skipped or turned off) but a different speed:
          // adjust the running spindle.
          if (spindleOn && runningSpeed !== spindleSpeed) {
            gcode.push(`M3 S${Math.round(spindleSpeed)}`);
            if (o.spindleDelay > 0) {
              gcode.push(`G4 P${round(o.spindleDelay)}`);
            }
            runningSpeed = spindleSpeed;
          }
          break;
      }
    }

    flushCuts();
    if (cycleActive) {
      out.line('G80');
    }

    /**
     * A hole as a canned cycle: one line of G-code, or (for the preview) the
     * moves it makes. Returns to safe height (G98), where it started.
     */
    function drill(cycle: DrillCycle) {
      flushCuts();
      const top = safeZ();
      const code = !cycle.peck
        ? cycle.dwell > 0
          ? 'G82'
          : 'G81'
        : cycle.chipBreak
          ? 'G73'
          : 'G83';
      // Wrapped, the hole's position is partly an angle: no canned cycle.
      if (out.cycle && !wrap) {
        if (z !== round(top + off.z)) {
          move('G0', { z: top });
        }
        const words = [
          `X${round(cycle.x + off.x)}`,
          `Y${round(cycle.y + off.y)}`,
          `Z${round(cycle.depth + off.z)}`,
          `R${round(cycle.retract + off.z)}`,
        ];
        if (cycle.peck) words.push(`Q${round(cycle.peck)}`);
        if (code === 'G82') words.push(`P${round(cycle.dwell)}`);
        if (plungeFeedRate !== feedRate) {
          feedRate = plungeFeedRate;
          words.push(`F${plungeFeedRate}`);
        }
        out.cycle(`${cycleActive ? '' : 'G98 '}${code} ${words.join(' ')}`);
        cycleActive = true;
        x = round(cycle.x + off.x);
        y = round(cycle.y + off.y);
        z = round(top + off.z);
        return;
      }
      // The moves the controller makes: pecks out to R (G83) or lifting a
      // little (G73), and the dwell at the bottom (G82).
      move('G0', { z: top });
      move('G0', { x: cycle.x, y: cycle.y });
      move('G0', { z: cycle.retract });
      let reached = cycle.retract; // pecks count from R
      const peck = cycle.peck > 0 ? cycle.peck : Infinity;
      while (reached > cycle.depth + 1e-9) {
        const next = Math.max(cycle.depth, reached - peck);
        move('G1', { z: next }, plungeFeedRate);
        reached = next;
        if (reached > cycle.depth + 1e-9) {
          move('G0', { z: cycle.chipBreak ? reached + 0.5 : cycle.retract });
          if (!cycle.chipBreak) move('G0', { z: reached });
        }
      }
      if (!cycle.peck && cycle.dwell > 0) {
        out.line(`G4 P${round(cycle.dwell)}`);
      }
      move('G0', { z: top });
    }

    /**
     * An arc (a helix with a change in Z): one G2/G3 when writing arcs,
     * else the lines standing in for it (within the curve tolerance).
     */
    function carveArc(to: CamPoint, toZ: number | undefined, bulge: number) {
      // Where the tool is, in design coordinates (held-back cuts included).
      const last = pendingCuts[pendingCuts.length - 1];
      const from: CamPoint3 = last ?? {
        x: x! - off.x,
        y: y! - off.y,
        z: z! - off.z,
      };
      const endZ = toZ ?? from.z;
      if (arcs && !wrap) {
        flushCuts();
        const arc = arcOf(from, to, bulge);
        const end = { ...to, z: endZ };
        if (arcMove(arc.sweep < 0, end, arc.center, carveFeedRate)) {
          return;
        }
      }
      const points = segmentPoints(from, to, bulge, o.curveTolerance);
      points.forEach((p, k) => {
        const pz = from.z + ((endZ - from.z) * (k + 1)) / points.length;
        if (arcs && !wrap) {
          pendingFeed = carveFeedRate;
          pendingCuts.push({ ...p, z: pz });
        } else {
          move('G1', { ...p, z: pz }, carveFeedRate);
        }
      });
    }

    /** Write the held-back cuts, as arcs where they follow a circle. */
    function flushCuts() {
      if (!pendingCuts.length) return;
      const cuts = pendingCuts;
      pendingCuts = [];
      const at = { x: x! - off.x, y: y! - off.y, z: z! - off.z };
      for (const m of fitArcs([at, ...cuts], arcTolerance)) {
        const end = m.to as CamPoint3;
        const done =
          m.type === 'arc' &&
          helical(m.points as CamPoint3[], m.center, end) &&
          arcMove(m.clockwise, end, m.center, pendingFeed);
        if (!done) {
          for (const p of (m.type === 'line'
            ? [m.to]
            : m.points) as CamPoint3[]) {
            move('G1', p, pendingFeed);
          }
        }
      }
    }

    /**
     * Whether the cut's height changes evenly round the arc (a helix, or
     * level), so one G2/G3 with a Z can stand for it.
     */
    function helical(points: CamPoint3[], center: CamPoint, end: CamPoint3) {
      const startZ = z! - off.z;
      if (points.every((p) => Math.abs(p.z - startZ) <= arcTolerance.points)) {
        return Math.abs(end.z - startZ) <= arcTolerance.points;
      }
      const startX = x! - off.x;
      const startY = y! - off.y;
      let previous = Math.atan2(startY - center.y, startX - center.x);
      let swept = 0;
      const angles = points.map((p) => {
        const a = Math.atan2(p.y - center.y, p.x - center.x);
        let delta = a - previous;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        previous = a;
        return (swept += Math.abs(delta));
      });
      const total = angles[angles.length - 1];
      return (
        total > 0 &&
        points.every(
          (p, k) =>
            Math.abs(startZ + ((end.z - startZ) * angles[k]) / total - p.z) <=
            arcTolerance.points,
        )
      );
    }

    /**
     * An arc from the current position, if it still is one once its ends
     * are rounded: the centre moves onto their perpendicular bisector, so
     * both ends are exactly as far from it.
     */
    function arcMove(
      clockwise: boolean,
      to: CamPoint3,
      center: CamPoint,
      feed: number,
    ) {
      const sx = x!;
      const sy = y!;
      const ex = round(to.x + off.x);
      const ey = round(to.y + off.y);
      const dx = ex - sx;
      const dy = ey - sy;
      const length = Math.hypot(dx, dy);
      if (length < 2 / factor) return false;
      const nx = -dy / length;
      const ny = dx / length;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const cx = center.x + off.x;
      const cy = center.y + off.y;
      const t = (cx - mx) * nx + (cy - my) * ny;
      const i = roundCenter(mx + nx * t - sx);
      const j = roundCenter(my + ny * t - sy);
      const startRadius = Math.hypot(i, j);
      const endRadius = Math.hypot(sx + i - ex, sy + j - ey);
      if (Math.abs(startRadius - endRadius) > 0.002) return false;

      const changed: MoveChange = { x: ex, y: ey };
      const ez = round(to.z + off.z);
      if (ez !== z) {
        z = changed.z = ez;
      }
      changed.i = i;
      changed.j = j;
      if (feed !== feedRate) {
        feedRate = changed.feed = feed;
      }
      x = ex;
      y = ey;
      out.move(clockwise ? 'G2' : 'G3', changed, { x: ex, y: ey, z: z ?? 0 });
      return true;
    }

    /**
     * A move to `to`, in design coordinates (or, `raw`, the G-code's own).
     */
    function move(
      code: 'G0' | 'G1',
      to: { x?: number; y?: number; z?: number; a?: number },
      feed?: number,
      raw = false,
    ) {
      // Held-back cuts come first (nothing to do while writing them).
      flushCuts();
      const changed: MoveChange = {};
      const shift = raw ? { x: 0, y: 0, z: 0 } : off;
      const from = { x, y, z, a };

      // Wrapped: across the axis is round it, the tool over the axis.
      if (wrap && !raw && rotary) {
        const key = rotary.along === 'x' ? 'y' : 'x';
        const across = to[key];
        if (typeof across === 'number') {
          const unrolled =
            angle! +
            wrapDirection(rotary) *
              ((across - rotary.across) / rotary.halfThickness) *
              (180 / Math.PI);
          // A rapid between cuts goes the short way round; a cut carries on
          // from where the last one was, however far round it goes.
          if (code === 'G0' && a !== null) {
            turns = 360 * Math.round((a - unrolled) / 360);
          }
          to = { ...to, [key]: rotary.across, a: unrolled + turns };
        }
      }

      if (typeof to.x === 'number') {
        const newX = round(to.x + shift.x);
        if (newX !== x) {
          x = changed.x = newX;
        }
      }

      if (typeof to.y === 'number') {
        const newY = round(to.y + shift.y);
        if (newY !== y) {
          y = changed.y = newY;
        }
      }

      if (typeof to.z === 'number') {
        const newZ = round(to.z + shift.z);
        if (newZ !== z) {
          z = changed.z = newZ;
        }
      }

      if (typeof to.a === 'number') {
        const newA = round(to.a);
        if (newA !== a) {
          a = changed.a = newA;
        }
      }

      let written = feed;
      if (wrap && rotary && code === 'G1' && typeof feed === 'number') {
        // The controller takes the A axis' degrees as millimetres: write F
        // so the cut goes at `feed` along the surface where the bit is.
        const dx = (x ?? 0) - (from.x ?? 0);
        const dy = (y ?? 0) - (from.y ?? 0);
        const dz = (z ?? 0) - (from.z ?? 0);
        const da = (a ?? 0) - (from.a ?? 0);
        const radius =
          rotary.halfThickness + ((z ?? 0) + (from.z ?? 0)) / 2 - off.z;
        const along = Math.hypot(
          dx,
          dy,
          dz,
          Math.max(0, radius) * da * (Math.PI / 180),
        );
        changed.speed = feed;
        if (along > 1e-9) {
          written =
            o.rotaryFeed === 'inverse-time'
              ? feed / along
              : (feed * Math.hypot(dx, dy, dz, da)) / along;
          written = Math.round(written * 1000) / 1000;
        }
        if (o.rotaryFeed === 'inverse-time') {
          if (!inverseTime) {
            gcode.push('G93');
            inverseTime = true;
          }
          // Each move's own time: an F on every one.
          feedRate = null;
        }
      }
      if (typeof written === 'number' && written !== feedRate) {
        feedRate = changed.feed = written;
      }

      if (
        changed.x !== undefined ||
        changed.y !== undefined ||
        changed.z !== undefined ||
        changed.a !== undefined ||
        changed.feed !== undefined
      ) {
        // Axes never set yet read as 0, as a G-code reader would assume.
        out.move(code, changed, {
          x: x ?? 0,
          y: y ?? 0,
          z: z ?? 0,
          a: a ?? 0,
          turns,
        });
      }
    }
  }
}

/** How long a program takes, in seconds: all of it, and per operation. */
export type JobTime = {
  total: number;
  /** By operation id ('' for moves belonging to none). */
  byOperation: Map<string, number>;
};

/** One hole, drilled by the controller's canned cycle. */
export type DrillCycle = {
  x: number;
  y: number;
  /** Z at the bottom of the hole. */
  depth: number;
  /** Z to rapid down to before drilling, and between pecks (R). */
  retract: number;
  /** Depth of each peck (Q), or 0 to drill in one go. */
  peck: number;
  /** Pecks only lift a little to break the chip (G73), not out (G83). */
  chipBreak: boolean;
  /** Seconds to wait at the bottom (G82; not with pecks). */
  dwell: number;
};

/** A builder as `GCodeBuilder.pack` sends it between threads. */
export type PackedGCode = {
  packedGCode: true;
  /** One `PackedOp` per instruction. */
  ops: Uint8Array;
  /** The moves' numbers, in instruction order. */
  nums: Float64Array;
  /** The instructions that aren't moves, in order. */
  other: PathInstruction[];
  isAtSafetyHeight: boolean;
};

const enum PackedOp {
  Travel,
  Carve,
  Plunge,
  Other,
  Arc,
}

/**
 * The axes (and feed) a move changes, already rounded; for an arc, also its
 * centre relative to the start (I, J).
 */
type MoveChange = {
  x?: number;
  y?: number;
  z?: number;
  /** The rotary axis' angle (degrees, as the stock turns). */
  a?: number;
  /**
   * Wrapped cuts: the feed rate (mm/min) the move goes at along the
   * surface, when `feed` is what's written for it instead (compensated, or
   * inverse time).
   */
  speed?: number;
  i?: number;
  j?: number;
  feed?: number;
};

/** Receives the G-code as `walk` produces it. */
type GcodeSink = {
  /** Any line that isn't a move (comments, spindle, tool changes, …). */
  line(text: string): void;
  /** A move, with what it changes and where it ends up. */
  move(
    code: 'G0' | 'G1' | 'G2' | 'G3',
    changed: MoveChange,
    at: CamPoint3 & {
      a?: number;
      /** Whole turns (degrees) added to wrapped cuts' angles. */
      turns?: number;
    },
  ): void;
  /** What the following moves belong to (an empty operation id clears it). */
  source?(kind: 'shape' | 'operation', id: string): void;
  /**
   * The stock about to turn to `angle` on the rotary axis (the bit is at
   * safe height), after which moves' Z is `shift` higher than in the
   * frame of the stock as turned.
   */
  rotate?(
    angle: number,
    shift: number,
    wrap: boolean,
    /** The axis' angle before, and after (the short way round to `angle`). */
    from: number,
    to: number,
  ): void;
  /**
   * A canned cycle as one line. Without it, cycles are handed to `move` as
   * the moves they make (for the preview).
   */
  cycle?(text: string): void;
};

export type PathInstruction =
  | { type: 'plunge'; depth: number }
  | { type: 'travel'; to: CamPoint }
  | { type: 'safety-height' }
  | {
      type: 'carve';
      to: CamPoint;
      z?: number;
      /** An arc from the previous position (see `arcTo`). */
      bulge?: number;
    }
  | { type: 'source-shape'; id: string }
  | { type: 'source-operation'; id: string }
  | { type: 'carve-feedrate'; feedRate: number | null }
  | { type: 'plunge-feedrate'; feedRate: number | null }
  | { type: 'model'; model: string }
  | { type: 'comment'; text: string }
  | { type: 'stop-program' }
  | { type: 'pause' }
  | { type: 'rapid-z'; z: number }
  | { type: 'dwell'; seconds: number }
  | {
      type: 'rotate';
      angle: number;
      /**
       * What follows is wrapped round a round stock: drawn unrolled, its
       * position across the axis is an angle round it from `angle`.
       */
      wrap?: boolean;
    }
  | ({ type: 'drill-cycle' } & DrillCycle)
  | {
      type: 'tool';
      toolNumber: number;
      label: string;
      /** Overrides the global spindle speed while this tool is in use. */
      spindleSpeed?: number;
    };
