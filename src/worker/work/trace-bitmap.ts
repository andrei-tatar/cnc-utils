import { simplifyPoints } from '../../cam/simplify';
import { fromPoints } from '../../cam/arcs';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import { traceContours } from '../../cam/marching-squares';
import { containingContours, signedArea2 } from '../../cam/polygon-nesting';
import { CamPoint, CamShape } from '../../cam/types';

export type TraceParameters = {
  /** The image, as a data URL. */
  image: string;
  /** 0–255: darker pixels (brightness below it) are traced. */
  threshold: number;
  /** Trace the light areas instead of the dark ones. */
  invert: boolean;
  /** Width of the traced result, in mm (the height follows). */
  width: number;
  /** Outlines enclosing less than this (mm²) are dropped: specks, noise. */
  minArea: number;
  /** How far (mm) outlines may move to lose points. */
  smoothing: number;
};

/** Longer images are scaled down to this many pixels first. */
const MAX_PIXELS = 1600;

/** Outlines of the image's dark (or light) areas, `width` mm wide. */
export async function traceBitmap(
  params: TraceParameters,
  sourceId: string,
  geometry?: GeometrySettings,
): Promise<CamShape[]> {
  useGeometry(geometry);
  if (!params.image || !(params.width > 0)) {
    return [];
  }

  const blob = await (await fetch(params.image)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  // Transparent areas count as white paper.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, w, h);
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = context.getImageData(0, 0, w, h);

  // Positive where traced: below the threshold (or above, inverted).
  const field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const brightness =
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    field[i] = params.invert
      ? brightness - params.threshold
      : params.threshold - brightness;
  }

  // Pixels to mm, Y up (images run top to bottom).
  const mm = params.width / w;
  const loops = traceContours(field, w, h).map((loop) =>
    loop.map(({ x, y }) => ({ x: x * mm, y: (h - 1 - y) * mm })),
  );

  const tolerance = Math.max(params.smoothing, curveTolerance());
  const kept: CamPoint[][] = [];
  for (const loop of loops) {
    if (Math.abs(signedArea2(loop)) / 2 < params.minArea) continue;
    const points = simplifyPoints(loop, tolerance, true);
    if (points.length > 2) {
      kept.push(points);
    }
  }
  // Outlines counter-clockwise and holes clockwise (by nesting), so every
  // reading of the shape agrees which areas are traced.
  const parents = containingContours(kept);
  const polygons = kept.map((points, i) => {
    const hole = parents[i].length % 2 === 1;
    const counterClockwise = signedArea2(points) > 0;
    return fromPoints(
      counterClockwise === hole ? [...points].reverse() : points,
      true,
    );
  });
  return polygons.length ? [{ sourceShapeId: sourceId, polygons }] : [];
}
