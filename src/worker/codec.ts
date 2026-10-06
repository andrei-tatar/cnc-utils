import { GCodeBuilder, PackedGCode } from '../cam/gcode-builder';
import { CamShape } from '../cam/types';

/**
 * Packs what crosses the worker boundary so it copies (or transfers)
 * quickly: a shape's points and a builder's moves become typed arrays,
 * instead of one small object per point that structured clone has to walk.
 * Everything else passes through as is.
 */

/** A `CamShape` with its points in typed arrays. */
type PackedShape = {
  packedShape: true;
  sourceShapeId: string;
  /** 1 for a closed polygon, 0 for an open one. */
  close: Uint8Array;
  /** Where each polygon's points start in `coords` (in points), plus the end. */
  offsets: Uint32Array;
  /** x, y of every point, polygon after polygon. */
  coords: Float64Array;
};

// The same shape is often sent to several jobs (one per operation using
// it); pack it once.
const packedShapes = new WeakMap<CamShape, PackedShape>();

/** `value` packed for `postMessage`. */
export function pack(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(pack);
  }
  if (value instanceof GCodeBuilder) {
    return GCodeBuilder.pack(value);
  }
  if (isCamShape(value)) {
    let packed = packedShapes.get(value);
    if (!packed) {
      packed = packShape(value);
      packedShapes.set(value, packed);
    }
    return packed;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key in value) {
      result[key] = pack(value[key]);
    }
    return result;
  }
  return value;
}

/** What `pack` made, back as it was. */
export function unpack(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unpack);
  }
  if (isPlainObject(value)) {
    if (value['packedShape'] === true) {
      return unpackShape(value as PackedShape);
    }
    if (value['packedGCode'] === true) {
      return GCodeBuilder.unpack(value as PackedGCode);
    }
    const result: Record<string, unknown> = {};
    for (const key in value) {
      result[key] = unpack(value[key]);
    }
    return result;
  }
  return value;
}

/** The buffers in a packed value, to transfer instead of copying. */
export function transferables(value: unknown, found: Transferable[] = []) {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer && !found.includes(value.buffer)) {
      found.push(value.buffer);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => transferables(v, found));
  } else if (isPlainObject(value)) {
    for (const key in value) {
      transferables(value[key], found);
    }
  }
  return found;
}

function packShape(shape: CamShape): PackedShape {
  const count = shape.polygons.reduce((n, p) => n + p.points.length, 0);
  const close = new Uint8Array(shape.polygons.length);
  const offsets = new Uint32Array(shape.polygons.length + 1);
  const coords = new Float64Array(count * 2);
  let at = 0;
  shape.polygons.forEach((polygon, i) => {
    close[i] = polygon.close ? 1 : 0;
    offsets[i] = at;
    for (const point of polygon.points) {
      coords[at * 2] = point.x;
      coords[at * 2 + 1] = point.y;
      at++;
    }
  });
  offsets[shape.polygons.length] = at;
  return {
    packedShape: true,
    sourceShapeId: shape.sourceShapeId,
    close,
    offsets,
    coords,
  };
}

function unpackShape(packed: PackedShape): CamShape {
  const { close, offsets, coords } = packed;
  const polygons = Array.from(close, (closed, i) => {
    const points = new Array(offsets[i + 1] - offsets[i]);
    for (let k = offsets[i], j = 0; k < offsets[i + 1]; k++, j++) {
      points[j] = { x: coords[k * 2], y: coords[k * 2 + 1] };
    }
    return { points, close: closed === 1 };
  });
  return { sourceShapeId: packed.sourceShapeId, polygons };
}

/**
 * Only an object with exactly a shape's fields, so nothing else is lost by
 * packing it.
 */
function isCamShape(value: unknown): value is CamShape {
  if (!isPlainObject(value) || !Array.isArray(value['polygons'])) {
    return false;
  }
  return (
    keyCount(value) === 2 &&
    typeof value['sourceShapeId'] === 'string' &&
    (value['polygons'] as unknown[]).every(isPolygon)
  );
}

function isPolygon(value: unknown) {
  if (!isPlainObject(value)) return false;
  const points = value['points'];
  return (
    keyCount(value) === 2 &&
    typeof value['close'] === 'boolean' &&
    Array.isArray(points) &&
    points.every(
      (p) =>
        isPlainObject(p) &&
        typeof p['x'] === 'number' &&
        typeof p['y'] === 'number' &&
        keyCount(p) === 2,
    )
  );
}

/** Number of own enumerable keys, without allocating a list of them. */
function keyCount(value: object) {
  let keys = 0;
  for (const _ in value) keys++;
  return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
