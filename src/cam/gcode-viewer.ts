import { CamPath } from './types';

const SOURCE_SHAPE_PREFIX = '; source-shape=';

export function gcodeToPaths(gcode: string): CamPath[] {
  const paths: CamPath[] = [];

  const lines = gcode.split('\n');

  let lastX = 0,
    lastY = 0,
    lastZ = 0,
    sourceShapeId: string = 'unknown',
    path: CamPath | null = null;

  for (const line of lines) {
    if (line.startsWith(SOURCE_SHAPE_PREFIX)) {
      sourceShapeId = line.substring(SOURCE_SHAPE_PREFIX.length);
      continue;
    }

    const [instruction, ...coords] = line.split(' ');

    let type: CamPath['type'];
    switch (instruction) {
      case 'G00':
        type = 'travel';
        break;
      case 'G01':
        type = 'carve';
        break;
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
      if (!path || type !== path.type || sourceShapeId !== path.sourceShapeId) {
        if (path?.points) {
          paths.push(path);
        }

        path = {
          points: [],
          sourceShapeId: sourceShapeId,
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
