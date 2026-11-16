import { operationPointInFrame, Rotary } from './rotary';
import { MeshBounds, meshBounds } from './stl';
import { CamPolygon } from './types';

/**
 * The transforms a 3D model shape takes, as its shape's transforms list
 * holds them: the 2D ones' fields, with those a third dimension adds.
 * Others in the list don't apply to a model and are passed over.
 */
export type MeshTransform =
  | {
      type: 'translate';
      translateX: number;
      translateY: number;
      translateZ?: number;
    }
  | {
      type: 'align';
      alignX: 'none' | 'left' | 'middle' | 'right';
      alignXTo: number;
      alignY: 'none' | 'top' | 'middle' | 'bottom';
      alignYTo: number;
      alignZ?: 'none' | 'top' | 'middle' | 'bottom';
      alignZTo?: number;
    }
  | {
      type: 'rotate';
      rotateAngle: number;
      /** The axis it turns round (Z, like a flat shape, when left out). */
      rotateAxis?: 'x' | 'y' | 'z';
      around: string;
      aroundX?: number;
      aroundY?: number;
      aroundZ?: number;
    }
  | { type: 'scale'; scaleX: number; scaleY: number; scaleZ?: number }
  | { type: string };

/** The transforms a 3D model shape takes (the others are for outlines). */
export const MESH_TRANSFORMS = ['translate', 'align', 'rotate', 'scale'];

const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * A mesh's triangles (nine numbers each, see `parseStl`) with a shape's
 * transforms applied in order, as they are to an outline: moved, aligned
 * by its bounding box, turned — round Z clockwise for a positive angle,
 * like a flat shape; round X or Y by the right-hand rule, as a rotary axis
 * along it turns the stock — and scaled from the origin.
 */
export function transformMesh(
  triangles: Float32Array,
  transforms: readonly MeshTransform[],
): Float32Array {
  let mesh = triangles;
  const each = (
    to: (x: number, y: number, z: number) => [number, number, number],
  ) => {
    const out = new Float32Array(mesh.length);
    for (let i = 0; i < mesh.length; i += 3) {
      const [x, y, z] = to(mesh[i], mesh[i + 1], mesh[i + 2]);
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = z;
    }
    mesh = out;
  };
  for (const transform of transforms) {
    const t = transform as any;
    switch (transform.type) {
      case 'translate': {
        const [dx, dy, dz] = [
          finite(t.translateX),
          finite(t.translateY),
          finite(t.translateZ),
        ];
        each((x, y, z) => [x + dx, y + dy, z + dz]);
        break;
      }
      case 'align': {
        const b = meshBounds(mesh);
        if (!Number.isFinite(b.minX)) break;
        const from = (
          side: string | undefined,
          min: number,
          max: number,
          to: unknown,
        ) =>
          side === 'left' || side === 'bottom'
            ? finite(to) - min
            : side === 'right' || side === 'top'
              ? finite(to) - max
              : side === 'middle'
                ? finite(to) - (min + max) / 2
                : 0;
        const dx = from(t.alignX, b.minX, b.maxX, t.alignXTo);
        const dy = from(t.alignY, b.minY, b.maxY, t.alignYTo);
        const dz = from(t.alignZ ?? 'none', b.minZ, b.maxZ, t.alignZTo);
        each((x, y, z) => [x + dx, y + dy, z + dz]);
        break;
      }
      case 'rotate': {
        const b = meshBounds(mesh);
        if (!Number.isFinite(b.minX)) break;
        const [cx, cy, cz] = pivot(b, t);
        const axis = t.rotateAxis ?? 'z';
        // Round Z clockwise, as flat shapes turn.
        const radians =
          ((axis === 'z' ? -1 : 1) * finite(t.rotateAngle) * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        each((x, y, z) => {
          const [u, v, w] = [x - cx, y - cy, z - cz];
          return axis === 'x'
            ? [x, cy + v * cos - w * sin, cz + v * sin + w * cos]
            : axis === 'y'
              ? [cx + u * cos + w * sin, y, cz - u * sin + w * cos]
              : [cx + u * cos - v * sin, cy + u * sin + v * cos, z];
        });
        break;
      }
      case 'scale': {
        const [sx, sy, sz] = [
          finite(t.scaleX, 1),
          finite(t.scaleY, 1),
          finite(t.scaleZ, 1),
        ];
        each((x, y, z) => [x * sx, y * sy, z * sz]);
        break;
      }
    }
  }
  return mesh;
}

/** What a rotate transform turns the mesh round. */
function pivot(b: MeshBounds, t: any): [number, number, number] {
  if (t.around === 'point') {
    return [finite(t.aroundX), finite(t.aroundY), finite(t.aroundZ)];
  }
  const [xs, ys] = String(t.around ?? 'xcenter-ycenter').split('-');
  const at = (side: string, min: number, max: number) =>
    side.endsWith('min') ? min : side.endsWith('max') ? max : (min + max) / 2;
  return [
    at(xs ?? '', b.minX, b.maxX),
    at(ys ?? '', b.minY, b.maxY),
    (b.minZ + b.maxZ) / 2,
  ];
}

/**
 * A mesh's footprint: the rectangle round it seen from above, which stands
 * for a 3D model shape wherever an outline is asked for. None for an empty
 * mesh.
 */
export function meshFootprint(triangles: Float32Array): CamPolygon[] {
  const b = meshBounds(triangles);
  if (!(b.maxX > b.minX) || !(b.maxY > b.minY)) {
    return [];
  }
  return [
    {
      vertices: [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ],
      close: true,
    },
  ];
}

/**
 * A mesh on the blank at 0° (Z from its top there) as an operation turned
 * to `angle` meets it: in that operation's frame, Z from the top as turned.
 */
export function modelTurnedTo(
  triangles: Float32Array,
  rotary: Rotary,
  angle: number,
): Float32Array {
  const out = new Float32Array(triangles.length);
  for (let i = 0; i < triangles.length; i += 3) {
    const p = operationPointInFrame(rotary, angle, {
      x: triangles[i],
      y: triangles[i + 1],
      z: triangles[i + 2],
    });
    out[i] = p.x;
    out[i + 1] = p.y;
    out[i + 2] = p.z;
  }
  return out;
}
