import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  curveTolerance,
  GeometrySettings,
  useGeometry,
} from '../../cam/geometry';
import { Bounds, polygonPoints, polygonsBounds } from '../../cam/arcs';
import {
  Brightness,
  EngraveRun,
  engraveRuns,
  ImageLayout,
  imagePlacement,
  quarterTurns,
  rotateBrightness,
} from '../../cam/image-engrave';
import { CamShape } from '../../cam/types';
import { brightnessAt, imagePixels } from './image-pixels';
import { shapeRegion } from './regions';

export type ImageEngraveOptions = {
  /** The image, as a data URL. */
  image: string;
  /** Where it goes on the shape. */
  layout: ImageLayout;
  /** Carve the light areas deepest instead of the dark ones. */
  invert: boolean;
  /** How deep white is carved (mm). */
  lightDepth: number;
  /** How deep black is carved (mm). */
  darkDepth: number;
  /** Depth follows darkness raised to this. */
  gamma: number;
  /** Between raster lines (mm). */
  spacing: number;
  /** Direction of the lines, degrees from the X axis. */
  angle: number;
  /** Between samples along a line (mm). */
  sampleStep: number;
  /** Every line cut the same way, instead of back and forth. */
  oneWay: boolean;
  /** The V-bit. */
  toolSize: number;
  vAngle: number;
  tipDiameter: number;
  geometry?: GeometrySettings;
};

/** Longer images are scaled down to this many pixels first. */
const MAX_PIXELS = 2400;

/**
 * Engraves an image with a V-bit inside the shape: raster lines across it,
 * each carved as deep as the image is dark where it passes (see
 * `engraveRuns`). The image is laid on the shape's bounding box as `layout`
 * says; the shape clips it.
 */
export async function routeImageEngrave(
  input: CamShape[],
  options: ImageEngraveOptions,
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

  let at = { x: 0, y: 0, z: 0 };
  for (const { points, linked } of await imageEngraveRuns(input, options)) {
    const [first, ...rest] = points;
    if (linked) {
      // Up out of the groove, across at the surface, into the next one.
      if (at.z < 0) {
        builder.carveTo(at.x, at.y, 0);
      }
      builder.carveTo(first.x, first.y, 0);
      if (first.z < 0) {
        builder.plunge(first.z);
      }
    } else {
      builder.goToSafeHeight();
      builder.travelTo(first.x, first.y);
      builder.plunge(first.z);
    }
    for (const p of rest) {
      builder.carveTo(p.x, p.y, p.z);
    }
    at = points[points.length - 1];
  }
  builder.goToSafeHeight();
  return builder;
}

/** The V-bit's cuts engraving the image (see `engraveRuns`). */
export async function imageEngraveRuns(
  input: CamShape[],
  options: ImageEngraveOptions,
): Promise<EngraveRun[]> {
  const tan = Math.tan(((options.vAngle / 2) * Math.PI) / 180);
  if (!options.image || !(tan > 0) || !(options.sampleStep > 0)) {
    return [];
  }
  const region = await shapeRegion(input);
  if (!region.length) {
    return [];
  }
  const loops = region.map((p) => polygonPoints(p, curveTolerance()));
  const box = polygonsBounds(region);

  // Drawn about a pixel per sample (no larger than it is).
  // Turned a quarter (or three) the image's width and height swap places.
  const turns = quarterTurns(options.layout.rotation);
  const sideways = turns % 2 === 1;
  let placement: Bounds = box;
  const pixels = await imagePixels(
    options.image,
    (width, height) => {
      const [w, h] = sideways ? [height, width] : [width, height];
      placement = imagePlacement(box, w, h, options.layout);
      const across = (mm: number, own: number) =>
        Math.min(own, MAX_PIXELS, Math.ceil(mm / options.sampleStep));
      const wide = across(placement.maxX - placement.minX, w);
      const high = across(placement.maxY - placement.minY, h);
      // Drawn as it is, turned after.
      return sideways
        ? { width: high, height: wide }
        : { width: wide, height: high };
    },
    'high',
  );
  const drawn: Brightness = {
    width: pixels.width,
    height: pixels.height,
    data: new Float32Array(pixels.width * pixels.height),
  };
  for (let i = 0; i < drawn.data.length; i++) {
    drawn.data[i] = brightnessAt(pixels.data, i) / 255;
  }
  const brightness = rotateBrightness(drawn, turns);

  // The bit can't carve deeper than its cone.
  const cone = vBitCone(options);
  return engraveRuns(loops, brightness, {
    placement,
    lightDepth: Math.min(cone, Math.max(0, options.lightDepth)),
    darkDepth: Math.min(cone, Math.max(0, options.darkDepth)),
    gamma: options.gamma,
    invert: options.invert,
    spacing: options.spacing,
    angle: options.angle,
    sampleStep: options.sampleStep,
    oneWay: options.oneWay,
    tolerance: curveTolerance(),
  });
}

/** How deep the V-bit's cone goes (mm). */
function vBitCone(
  options: Pick<ImageEngraveOptions, 'toolSize' | 'vAngle' | 'tipDiameter'>,
) {
  const tan = Math.tan(((options.vAngle / 2) * Math.PI) / 180);
  return (
    Math.max(0, options.toolSize / 2 - Math.max(0, options.tipDiameter / 2)) /
    tan
  );
}
