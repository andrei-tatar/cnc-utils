import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import { drillPositions } from './route-drill';

/**
 * Keyhole slots: at each place the bit plunges to depth (its head cuts the
 * entry hole), runs `slotLength` along `slotAngle` (the neck cuts the slot
 * above the head's undercut), comes back to the entry hole and lifts out.
 */
export async function routeKeyhole(
  input: CamShape[],
  options: {
    keyholeAt: 'points' | 'centers';
    startDepth: number;
    depth: number;
    slotLength: number;
    /** Degrees from +X, counter-clockwise. */
    slotAngle: number;
    geometry?: GeometrySettings;
    optimizeTravel?: boolean;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  const top = -options.startDepth;
  const bottom = top - Math.max(0, options.depth);
  if (!(bottom < top)) {
    return builder;
  }
  const angle = ((options.slotAngle ?? 90) * Math.PI) / 180;
  const length = Math.max(0, options.slotLength);
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;

  builder.goToSafeHeight();
  for (const hole of drillPositions(
    input,
    options.keyholeAt,
    options.optimizeTravel,
  )) {
    builder.travelTo(hole.x, hole.y);
    builder.plunge(bottom);
    if (length > 0) {
      builder.carveTo(hole.x + dx, hole.y + dy);
      builder.carveTo(hole.x, hole.y);
    }
    builder.goToSafeHeight();
  }
  return builder;
}
