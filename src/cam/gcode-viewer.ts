import { CamPath } from './types';

const SOURCE_SHAPE_PREFIX = '; source-shape=';
const SOURCE_OPERATION_PREFIX = '; source-operation=';

export function gcodeToPaths(gcode: string): CamPath[] {
  const paths: CamPath[] = [];

  const lines = gcode.split('\n');

  let lastX = 0,
    lastY = 0,
    lastZ = 0,
    sourceShapeId: string = 'unknown',
    sourceOperationId: string | undefined = undefined,
    path: CamPath | null = null;

  for (const line of lines) {
    if (line.startsWith(';')) {
      if (line.startsWith(SOURCE_SHAPE_PREFIX)) {
        sourceShapeId = line.substring(SOURCE_SHAPE_PREFIX.length);
      } else if (line.startsWith(SOURCE_OPERATION_PREFIX)) {
        sourceOperationId =
          line.substring(SOURCE_OPERATION_PREFIX.length) || undefined;
      }
      continue;
    }

    const [instruction, ...coords] = line.split(' ');

    // Tool select / change ("T2 M6"): nothing to draw.
    if (/^T\d+$/.test(instruction)) {
      continue;
    }

    let type: CamPath['type'];
    switch (instruction) {
      case 'G0':
        type = 'travel';
        break;
      case 'G1':
        type = 'carve';
        break;
      case 'M30':
        // stop program; nothing to show
        continue;
      case 'M00':
        // pause; nothing to show
        continue;
      case 'M6':
        // tool change on its own line; nothing to show
        continue;

      default:
        throw new Error(`unsupported gcode instruction ${instruction}`);
    }

    const x: number | null =
      getValue(coords.find((v) => v.startsWith('X'))) ?? lastX;
    const y: number | null =
      getValue(coords.find((v) => v.startsWith('Y'))) ?? lastY;
    const z: number | null =
      getValue(coords.find((v) => v.startsWith('Z'))) ?? lastZ;

    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof z === 'number'
    ) {
      if (
        !path ||
        type !== path.type ||
        sourceShapeId !== path.sourceShapeId ||
        sourceOperationId !== path.sourceOperationId
      ) {
        if (path?.points) {
          paths.push(path);
        }

        path = {
          points: [],
          sourceShapeId: sourceShapeId,
          sourceOperationId,
          type,
        };

        if (
          typeof lastX === 'number' &&
          typeof lastY === 'number' &&
          typeof lastZ === 'number'
        ) {
          path.points.push({ x: lastX, y: lastY, z: lastZ });
        }
      }

      path.points.push({ x, y, z });
    }

    lastX = x;
    lastY = y;
    lastZ = z;
  }

  if (path) {
    paths.push(path);
  }

  return paths;
}

function getValue(coord: string | undefined): number | null {
  if (!coord) {
    return null;
  }

  return +coord.substring(1);
}
