import { GcodeOptions, resolveGcodeOptions } from './gcode-options';
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

  concat(other: GCodeBuilder): GCodeBuilder {
    const result = new GCodeBuilder();
    result._instructions = this._instructions.concat(other._instructions);
    result._isAtSafetyHeight = other._isAtSafetyHeight;
    return result;
  }

  build(options: Partial<GcodeOptions> = {}): string {
    const gcode: string[] = [];
    this.walk(options, {
      line: (text) => gcode.push(text),
      move: (code, changed) => {
        const coords: string[] = [];
        if (changed.x !== undefined) coords.push(`X${changed.x}`);
        if (changed.y !== undefined) coords.push(`Y${changed.y}`);
        if (changed.z !== undefined) coords.push(`Z${changed.z}`);
        if (changed.feed !== undefined) coords.push(`F${changed.feed}`);
        gcode.push(`${code} ${coords.join(' ')}`);
      },
    });
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

  /** Walks the instructions as G-code, handing each line or move to `out`. */
  private walk(options: Partial<GcodeOptions>, out: GcodeSink) {
    const o = resolveGcodeOptions(options);
    const factor = 10 ** Math.max(0, Math.min(6, Math.round(o.decimals)));
    const round = (v: number) => Math.round(v * factor) / factor;
    const gcode = { push: out.line };

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

    for (const instruction of this._instructions) {
      switch (instruction.type) {
        case 'safety-height':
          move('G0', { z: o.safetyHeight });
          break;

        case 'plunge':
          //TODO: optional helical plunge ?
          startSpindle();
          move('G1', { z: instruction.depth }, plungeFeedRate);
          break;

        case 'travel':
          move('G0', instruction.to);
          break;

        case 'carve':
          startSpindle();
          move('G1', { ...instruction.to, z: instruction.z }, carveFeedRate);
          break;

        case 'source-shape':
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
            move('G0', { x: 0, y: 0 });
          }
          gcode.push('M30');
          break;

        case 'pause':
          gcode.push('M00');
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

    function move(
      code: 'G0' | 'G1',
      to: { x?: number; y?: number; z?: number },
      feed?: number,
    ) {
      const changed: MoveChange = {};

      if (typeof to.x === 'number') {
        const newX = round(to.x);
        if (newX !== x) {
          x = changed.x = newX;
        }
      }

      if (typeof to.y === 'number') {
        const newY = round(to.y);
        if (newY !== y) {
          y = changed.y = newY;
        }
      }

      if (typeof to.z === 'number') {
        const newZ = round(to.z);
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

/** The axes (and feed) a move changes, already rounded. */
type MoveChange = { x?: number; y?: number; z?: number; feed?: number };

/** Receives the G-code as `walk` produces it. */
type GcodeSink = {
  /** Any line that isn't a move (comments, spindle, tool changes, …). */
  line(text: string): void;
  /** A move, with what it changes and where it ends up. */
  move(code: 'G0' | 'G1', changed: MoveChange, at: CamPoint3): void;
  /** What the following moves belong to (an empty operation id clears it). */
  source?(kind: 'shape' | 'operation', id: string): void;
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
  | {
      type: 'tool';
      toolNumber: number;
      label: string;
      /** Overrides the global spindle speed while this tool is in use. */
      spindleSpeed?: number;
    };
