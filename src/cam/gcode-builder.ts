import { CamPoint } from './types';

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

  carveTo(x: number, y: number) {
    this._instructions.push({ type: 'carve', to: { x, y } });
    return this;
  }

  sourceShapeId(id: string) {
    this._instructions.push({ type: 'source-shape', id });
    return this;
  }

  carveFeedrate(feedRate: number) {
    this._instructions.push({ type: 'carve-feedrate', feedRate });
    return this;
  }

  plungeFeedRate(feedRate: number) {
    this._instructions.push({ type: 'plunge-feedrate', feedRate });
    return this;
  }

  addModelMetadata(model: string) {
    this._instructions.push({ type: 'model', model });
    return this;
  }

  concat(other: GCodeBuilder): GCodeBuilder {
    const result = new GCodeBuilder();
    result._instructions = this._instructions.concat(other._instructions);
    result._isAtSafetyHeight = other._isAtSafetyHeight;
    return result;
  }

  build(options: {
    safetyHeight: number;
    carveFeedRate: number;
    plungeFeedRate: number;
  }): string {
    const gcode: string[] = [];

    let x: number | null = null,
      y: number | null = null,
      z: number | null = null,
      feedRate: number | null = null,
      carveFeedRate = options.carveFeedRate,
      plungeFeedRate = options.plungeFeedRate;

    for (const instruction of this._instructions) {
      switch (instruction.type) {
        case 'safety-height':
          move('G00', { z: options.safetyHeight });
          break;

        case 'plunge':
          //TODO: optional helical plunge ?
          move('G01', { z: instruction.depth }, plungeFeedRate);
          break;

        case 'travel':
          move('G00', instruction.to);
          break;

        case 'carve':
          move('G01', instruction.to, carveFeedRate);
          break;

        case 'source-shape':
          gcode.push(`; source-shape=${instruction.id}`);
          break;

        case 'carve-feedrate':
          carveFeedRate = instruction.feedRate;
          break;

        case 'plunge-feedrate':
          plungeFeedRate = instruction.feedRate;
          break;

        case 'model':
          gcode.push(`; model=${instruction.model}`);
          break;
      }
    }

    return gcode.join('\n');

    function move(
      code: string,
      to: { x?: number; y?: number; z?: number },
      feed?: number,
    ) {
      const coords: string[] = [];

      if (typeof to.x === 'number') {
        const newX = round(to.x);
        if (newX !== x) {
          x = newX;
          coords.push(`X${x}`);
        }
      }

      if (typeof to.y === 'number') {
        const newY = round(to.y);
        if (newY !== y) {
          y = newY;
          coords.push(`Y${y}`);
        }
      }

      if (typeof to.z === 'number') {
        const newZ = round(to.z);
        if (newZ !== z) {
          z = newZ;
          coords.push(`Z${z}`);
        }
      }

      if (typeof feed === 'number' && feed !== feedRate) {
        feedRate = feed;
        coords.push(`F${feedRate}`);
      }

      if (coords.length) {
        gcode.push(`${code} ${coords.join(' ')}`);
      }
    }
  }
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

type PathInstruction =
  | { type: 'plunge'; depth: number }
  | { type: 'travel'; to: CamPoint }
  | { type: 'safety-height' }
  | { type: 'carve'; to: CamPoint }
  | { type: 'source-shape'; id: string }
  | { type: 'carve-feedrate'; feedRate: number }
  | { type: 'plunge-feedrate'; feedRate: number }
  | { type: 'model'; model: string };
