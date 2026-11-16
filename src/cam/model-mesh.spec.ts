import { meshFootprint, modelTurnedTo, transformMesh } from './model-mesh';
import { operationPointInFrame, operationPointOnBlank, Rotary } from './rotary';
import { meshBounds } from './stl';

/** A box's opposite corners as one (flat) triangle: enough for bounds. */
function box([x0, y0, z0]: number[], [x1, y1, z1]: number[]): Float32Array {
  return Float32Array.from([x0, y0, z0, x1, y1, z1, x0, y1, z0]);
}

const bounds = (mesh: Float32Array) => {
  const b = meshBounds(mesh);
  return [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].map(
    (v) => Math.round(v * 1e4) / 1e4,
  );
};

describe('3D model shapes', () => {
  const model = box([0, 0, 0], [2, 4, 6]);

  it('moves, scales and aligns a mesh in three dimensions', () => {
    expect(
      bounds(
        transformMesh(model, [
          { type: 'translate', translateX: 1, translateY: 2, translateZ: -3 },
        ]),
      ),
    ).toEqual([1, 3, 2, 6, -3, 3]);
    expect(
      bounds(
        transformMesh(model, [
          { type: 'scale', scaleX: 2, scaleY: 0.5, scaleZ: 3 },
        ]),
      ),
    ).toEqual([0, 4, 0, 2, 0, 18]);
    expect(
      bounds(
        transformMesh(model, [
          {
            type: 'align',
            alignX: 'middle',
            alignXTo: 10,
            alignY: 'none',
            alignYTo: 99,
            alignZ: 'top',
            alignZTo: 0,
          },
        ]),
      ),
    ).toEqual([9, 11, 0, 4, -6, 0]);
    // Without a Z (a transform made for a flat shape), Z stays.
    expect(
      bounds(
        transformMesh(model, [
          { type: 'translate', translateX: 1, translateY: 1 },
          { type: 'scale', scaleX: 2, scaleY: 2 },
          { type: 'offset' },
        ]),
      ),
    ).toEqual([2, 6, 2, 10, 0, 6]);
  });

  it('turns a mesh round each axis', () => {
    const point = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const turn = (rotateAxis: 'x' | 'y' | 'z') =>
      Array.from(
        transformMesh(point, [
          {
            type: 'rotate',
            rotateAngle: 90,
            rotateAxis,
            around: 'point',
            aroundX: 0,
            aroundY: 0,
            aroundZ: 0,
          },
        ]),
        (v) => Math.round(v * 1e6) / 1e6 + 0,
      );
    // Round Z clockwise, like a flat shape: +Y goes to +X.
    expect(turn('z')).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
    // Round X and Y by the right-hand rule: +Y up round X, +Z to +X round Y.
    expect(turn('x')).toEqual([1, 0, 0, 0, 0, 1, 0, -1, 0]);
    expect(turn('y')).toEqual([0, 0, -1, 0, 1, 0, 1, 0, 0]);
    // Round the middle of its box by default: laid down, it stays put.
    expect(
      bounds(
        transformMesh(model, [
          {
            type: 'rotate',
            rotateAngle: 90,
            rotateAxis: 'y',
            around: 'xcenter-ycenter',
          },
        ]),
      ),
    ).toEqual([-2, 4, 0, 4, 2, 4]);
  });

  it('stands for an outline as the rectangle round it', () => {
    expect(meshFootprint(model)).toEqual([
      {
        vertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 4 },
          { x: 0, y: 4 },
        ],
        close: true,
      },
    ]);
    expect(meshFootprint(new Float32Array(0))).toEqual([]);
  });

  it('meets an operation turned with the stock from the side that’s up', () => {
    const rotary: Rotary = {
      along: 'x',
      across: 20,
      halfWidth: 20,
      halfThickness: 20,
      round: true,
    };
    // On the axis, reaching 6 towards +Y and 2 up.
    const mesh = box([0, 20, -20], [60, 26, -18]);
    const turned = meshBounds(modelTurnedTo(mesh, rotary, 90));
    // Turned a quarter, what was at +Y is up.
    expect(turned.maxZ).toBeCloseTo(-14, 6);
    expect(turned.minZ).toBeCloseTo(-20, 6);
    expect(turned.minY).toBeCloseTo(18, 6);
    expect(turned.maxY).toBeCloseTo(20, 6);
  });
});

describe('operationPointInFrame', () => {
  it('undoes operationPointOnBlank', () => {
    for (const along of ['x', 'y'] as const) {
      const rotary: Rotary = {
        along,
        across: 12,
        halfWidth: 30,
        halfThickness: 10,
        round: false,
      };
      for (const angle of [0, 30, 90, 180, 265]) {
        const p = { x: 5, y: -7, z: -3 };
        const back = operationPointInFrame(
          rotary,
          angle,
          operationPointOnBlank(rotary, angle, p),
        );
        expect(back.x).withContext(`${along} ${angle}`).toBeCloseTo(p.x, 9);
        expect(back.y).withContext(`${along} ${angle}`).toBeCloseTo(p.y, 9);
        expect(back.z).withContext(`${along} ${angle}`).toBeCloseTo(p.z, 9);
      }
    }
  });
});
