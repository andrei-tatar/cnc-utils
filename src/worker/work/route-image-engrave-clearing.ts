import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings, useGeometry } from '../../cam/geometry';
import { lowestReach } from '../../cam/image-engrave-clearing';
import { simulateStock } from '../../cam/simulate';
import { CamPath, CamShape } from '../../cam/types';
import { clearOverSurface, SurfaceClearingOptions } from './clear-surface';
import { ImageEngraveOptions, imageEngraveRuns } from './route-image-engrave';

export type ImageEngraveClearingOptions = SurfaceClearingOptions & {
  /** The engraving it clears for. */
  engrave: ImageEngraveOptions;
  /** Left above what the engraving cuts (mm), for the V-bit to finish. */
  leaveStock: number;
  geometry?: GeometrySettings;
};

/** The engraved surface is worked out on cells about this size (mm)… */
const CELL = 0.1;
/** …unless that takes more cells than this. */
const MAX_CELLS = 4_000_000;

/**
 * Clears the bulk of what an image engraving takes away with an end mill,
 * so the V-bit after it only finishes. Works out the surface the engraving
 * leaves (its V-bit swept along its cuts), then level by level outlines
 * where that surface is `leaveStock` or more below the level and pockets
 * the outlines there (rings inwards, like a pocket's offset strategy).
 */
export async function routeImageEngraveClearing(
  input: CamShape[],
  options: ImageEngraveClearingOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  const sourceShapeId = input?.[0]?.sourceShapeId;
  builder.sourceShapeId(sourceShapeId);
  if (!(options.toolSize > 0) || !(options.toolEngagement > 0)) {
    return builder;
  }

  const engraving = await imageEngraveRuns(input, options.engrave);
  const paths: CamPath[] = engraving.map(({ points }) => ({
    sourceShapeId: '',
    sourceOperationId: 'engrave',
    points,
    type: 'carve',
  }));
  let box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  let deepest = 0;
  for (const { points } of engraving) {
    for (const p of points) {
      box = {
        minX: Math.min(box.minX, p.x),
        minY: Math.min(box.minY, p.y),
        maxX: Math.max(box.maxX, p.x),
        maxY: Math.max(box.maxY, p.y),
      };
      deepest = Math.min(deepest, p.z);
    }
  }
  if (!(deepest < 0)) {
    return builder;
  }

  // Round the cuts as far as the V-bit reaches, and uncut surface beyond
  // so every outline closes on the map.
  const border = options.engrave.toolSize / 2 + 2 * CELL;
  const width = box.maxX - box.minX + 2 * border;
  const height = box.maxY - box.minY + 2 * border;
  const surface = simulateStock(
    paths,
    {
      engrave: {
        bitType: 'v-bit',
        diameter: options.engrave.toolSize,
        vAngle: options.engrave.vAngle,
        tipDiameter: options.engrave.tipDiameter,
      },
    },
    {
      minX: box.minX - border,
      minY: box.minY - border,
      maxX: box.maxX + border,
      maxY: box.maxY + border,
      top: 0,
      bottom: deepest - 1,
    },
    Math.min(MAX_CELLS, Math.ceil((width * height) / (CELL * CELL))),
  );

  // The surface is known at cell centres; between them it can rise up to
  // half a cell's diagonal along the V's flank. Kept clear of that too.
  const tan = Math.tan(((options.engrave.vAngle / 2) * Math.PI) / 180);
  const rise = (surface.cell * Math.SQRT1_2) / Math.max(tan, 1e-6);
  const margin = Math.max(0, options.leaveStock) + rise;
  // Down to the deepest the end mill reaches (the ridges between grooves
  // hold it up), not the bottom of the grooves; and a rise above that, so
  // the ridges, sampled anywhere on their flanks, all count as below it.
  const total = -lowestReach(surface, options.toolSize / 2) - margin - rise;
  await clearOverSurface(builder, surface, margin, total, options);
  builder.goToSafeHeight();
  return builder;
}
