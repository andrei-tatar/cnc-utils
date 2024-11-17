import { CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';

export async function flatOutline(
  input: CamShape[],
  options: {
    toolSize: number;
    toolEngagement: number;
    depth: number;
    interpolateStepSize: boolean;
    allPassesInSameDirection: boolean;
  },
): Promise<GCodeBuilder> {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const p of input.flatMap((i) => i.polygons.flatMap((p) => p.points))) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  let stepSize = options.toolSize * options.toolEngagement;

  if (options.interpolateStepSize) {
    const width = maxX - minX;
    const steps = width / stepSize;
    if (Math.floor(steps) !== steps) {
      stepSize = width / Math.ceil(steps);
    }
  }

  const builder = new GCodeBuilder();

  builder.sourceShapeId(input[0]?.sourceShapeId);
  builder.goToSafeHeight();

  builder.travelTo(minX, minY);
  builder.plunge(-options.depth);

  let isAtMinY = true;

  let x = minX;
  while (x < maxX) {

    if (options.allPassesInSameDirection) {
      builder.plunge(-options.depth);
      builder.carveTo(x, maxY);
      x += stepSize;
      builder.goToSafeHeight();
      builder.travelTo(x, minY);
    } else {
      builder.carveTo(x, isAtMinY ? maxY : minY);
      x += stepSize;
      builder.carveTo(x, isAtMinY ? maxY : minY);
      isAtMinY = !isAtMinY;
    }
  }

  builder.carveTo(x, isAtMinY ? maxY : minY);

  builder.goToSafeHeight();

  return builder;
}
