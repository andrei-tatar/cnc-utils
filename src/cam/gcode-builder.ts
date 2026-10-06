import { GcodeOptions, resolveGcodeOptions } from './gcode-options';
import { fitArcs } from './arc-fit';
import { CamPath, CamPoint, CamPoint3 } from './types';

export class GCodeBuilder {
  private _instructions: PathInstruction[] = [];
  private _isAtSafetyHeight = false;

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
          ops.push(PackedOp.Carve);
          nums.push(i.to.x, i.to.y, i.z ?? NaN);
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
          if (changed.i !== undefined) coords.push(`I${changed.i}`);
          if (changed.j !== undefined) coords.push(`J${changed.j}`);
          if (changed.feed !== undefined) coords.push(`F${changed.feed}`);
          gcode.push(`${code} ${coords.join(' ')}`);
        },
      },
      resolveGcodeOptions(options).arcs,
    );
    return gcode.join('\n');
  }

  /**
   * The moves the G-code makes, as paths for the preview: what parsing
   * `build(options)` back would give, without writing the text. A new path
   * starts whenever the move type or the source shape/operation changes.
   */
  toPaths(options: Partial<GcodeOptions> = {}): CamPath[] {
    const paths: CamPath[] = [];
    let path: CamPath | null = null;
    let sourceShapeId = 'unknown';
    let sourceOperationId: string | undefined = undefined;
    let last: CamPoint3 = { x: 0, y: 0, z: 0 };

    this.walk(options, {
      line: () => {},
      source: (kind, id) => {
        if (kind === 'shape') sourceShapeId = id;
        else sourceOperationId = id || undefined;
      },
      move: (code, _, at) => {
        const type = code === 'G0' ? 'travel' : 'carve';
        if (
          !path ||
          type !== path.type ||
          sourceShapeId !== path.sourceShapeId ||
          sourceOperationId !== path.sourceOperationId
        ) {
          if (path) paths.push(path);
          path = { points: [last], sourceShapeId, sourceOperationId, type };
        }
        last = at;
        path.points.push(at);
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
    let last: CamPoint3 | null = null;
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
      move: (code, changed, at) => {
        if (changed.feed !== undefined) feed = changed.feed;
        if (last) {
          const length = Math.hypot(
            at.x - last.x,
            at.y - last.y,
            at.z - last.z,
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
    // Design coordinates to the G-code's (its zero on the stock, if set).
    const off = o.offset ?? { x: 0, y: 0, z: 0 };
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
          move('G0', { z: o.safetyHeight });
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
          if (arcs && x !== null && y !== null && z !== null) {
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

        case 'stop-program':
          stopSpindle();
          if (o.returnHome) {
            move('G0', { z: o.safetyHeight });
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
            move('G0', { z: o.safetyHeight });
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
      const top = o.safetyHeight;
      const code = !cycle.peck
        ? cycle.dwell > 0
          ? 'G82'
          : 'G81'
        : cycle.chipBreak
          ? 'G73'
          : 'G83';
      if (out.cycle) {
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
          arcMove(m.clockwise, end, m.center);
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
    function arcMove(clockwise: boolean, to: CamPoint3, center: CamPoint) {
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
      if (pendingFeed !== feedRate) {
        feedRate = changed.feed = pendingFeed;
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
      to: { x?: number; y?: number; z?: number },
      feed?: number,
      raw = false,
    ) {
      // Held-back cuts come first (nothing to do while writing them).
      flushCuts();
      const changed: MoveChange = {};
      const shift = raw ? { x: 0, y: 0, z: 0 } : off;

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

      if (typeof feed === 'number' && feed !== feedRate) {
        feedRate = changed.feed = feed;
      }

      if (
        changed.x !== undefined ||
        changed.y !== undefined ||
        changed.z !== undefined ||
        changed.feed !== undefined
      ) {
        // Axes never set yet read as 0, as a G-code reader would assume.
        out.move(code, changed, { x: x ?? 0, y: y ?? 0, z: z ?? 0 });
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
}

/**
 * The axes (and feed) a move changes, already rounded; for an arc, also its
 * centre relative to the start (I, J).
 */
type MoveChange = {
  x?: number;
  y?: number;
  z?: number;
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
    at: CamPoint3,
  ): void;
  /** What the following moves belong to (an empty operation id clears it). */
  source?(kind: 'shape' | 'operation', id: string): void;
  /**
   * A canned cycle as one line. Without it, cycles are handed to `move` as
   * the moves they make (for the preview).
   */
  cycle?(text: string): void;
};

type PathInstruction =
  | { type: 'plunge'; depth: number }
  | { type: 'travel'; to: CamPoint }
  | { type: 'safety-height' }
  | { type: 'carve'; to: CamPoint; z?: number }
  | { type: 'source-shape'; id: string }
  | { type: 'source-operation'; id: string }
  | { type: 'carve-feedrate'; feedRate: number | null }
  | { type: 'plunge-feedrate'; feedRate: number | null }
  | { type: 'model'; model: string }
  | { type: 'stop-program' }
  | { type: 'pause' }
  | { type: 'rapid-z'; z: number }
  | { type: 'dwell'; seconds: number }
  | ({ type: 'drill-cycle' } & DrillCycle)
  | {
      type: 'tool';
      toolNumber: number;
      label: string;
      /** Overrides the global spindle speed while this tool is in use. */
      spindleSpeed?: number;
    };
