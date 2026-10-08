import {
  Brightness,
  depthAt,
  EngraveOptions,
  engraveRuns,
  ImageLayout,
  imagePlacement,
  LIFT_OVER,
  simplifyDepths,
} from './image-engrave';
import { CamPoint } from './types';

describe('image engraving', () => {
  const square = (size: number): CamPoint[] => [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  /** An image `width` px wide, each pixel's brightness from `at(x, y)`. */
  const image = (
    width: number,
    height: number,
    at: (x: number, y: number) => number,
  ): Brightness => {
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = at(x, y);
    }
    return { width, height, data };
  };
  const options = (o: Partial<EngraveOptions> = {}): EngraveOptions => ({
    placement: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    lightDepth: 0,
    darkDepth: 1,
    gamma: 1,
    invert: false,
    spacing: 1,
    angle: 0,
    sampleStep: 0.1,
    oneWay: false,
    tolerance: 0.01,
    ...o,
  });

  it('fits the image in the box', () => {
    const box = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
    const layout: ImageLayout = {
      fit: 'contain',
      scale: 100,
      alignX: 'center',
      alignY: 'middle',
      offsetX: 0,
      offsetY: 0,
    };
    expect(imagePlacement(box, 100, 100, layout)).toEqual({
      minX: 5,
      maxX: 15,
      minY: 0,
      maxY: 10,
    });
    expect(imagePlacement(box, 100, 100, { ...layout, fit: 'cover' })).toEqual({
      minX: 0,
      maxX: 20,
      minY: -5,
      maxY: 15,
    });
    expect(
      imagePlacement(box, 100, 100, { ...layout, fit: 'stretch' }),
    ).toEqual(box);
  });

  it('scales, aligns and moves the image', () => {
    const box = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
    const layout: ImageLayout = {
      fit: 'contain',
      scale: 50,
      alignX: 'left',
      alignY: 'top',
      offsetX: 1,
      offsetY: -2,
    };
    // 5 × 5, in the top left corner, then 1 right and 2 down.
    expect(imagePlacement(box, 100, 100, layout)).toEqual({
      minX: 1,
      maxX: 6,
      minY: 3,
      maxY: 8,
    });
    expect(
      imagePlacement(box, 100, 100, {
        ...layout,
        alignX: 'right',
        alignY: 'bottom',
        offsetX: 0,
        offsetY: 0,
      }),
    ).toEqual({ minX: 15, maxX: 20, minY: 0, maxY: 5 });
  });

  it('carves as deep as the image is dark, image rows from the top', () => {
    // Top half black, bottom half white.
    const img = image(2, 2, (_, y) => (y === 0 ? 0 : 1));
    const o = options({ lightDepth: 0.1, darkDepth: 0.5 });
    expect(depthAt(img, { x: 5, y: 9.9 }, o)).toBeCloseTo(0.5);
    expect(depthAt(img, { x: 5, y: 0.1 }, o)).toBeCloseTo(0.1);
    // Half way: grey.
    expect(depthAt(img, { x: 5, y: 5 }, o)).toBeCloseTo(0.3);
    expect(depthAt(img, { x: 5, y: 9.9 }, { ...o, invert: true })).toBeCloseTo(
      0.1,
    );
    // Outside the image nothing is carved.
    expect(depthAt(img, { x: 11, y: 5 }, o)).toBe(0);
  });

  it('bends mid-tones with gamma', () => {
    const grey = image(1, 1, () => 0.5);
    expect(depthAt(grey, { x: 5, y: 5 }, options({ gamma: 2 }))).toBeCloseTo(
      0.25,
    );
  });

  it('cuts back and forth along X, linked at the surface', () => {
    const black = image(1, 1, () => 0);
    const runs = engraveRuns([square(10)], black, options());
    // Lines 1 … 9 (the edges are left out), alternating.
    expect(runs.length).toBe(9);
    expect(runs.map((r) => r.points[0].y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(runs[0].points[0].x).toBeCloseTo(0);
    expect(runs[1].points[0].x).toBeCloseTo(10);
    expect(runs.slice(1).every((r) => r.linked)).toBeTrue();
    // A flat depth needs only the ends.
    expect(runs[0].points.length).toBe(2);
    expect(runs[0].points.every((p) => p.z === -1)).toBeTrue();
  });

  it('turns the lines', () => {
    const black = image(1, 1, () => 0);
    const runs = engraveRuns([square(10)], black, options({ angle: 90 }));
    for (const { points } of runs) {
      expect(points[0].x).toBeCloseTo(points[points.length - 1].x);
    }
  });

  it('lifts over long white stretches, keeps short ones', () => {
    // Black at both ends of a 30 mm wide image, white in between.
    const img = image(30, 1, (x) => (x < 2 || x >= 28 ? 0 : 1));
    const box = { minX: 0, minY: 0, maxX: 30, maxY: 2 };
    const loops = [
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 2 },
        { x: 0, y: 2 },
      ],
    ];
    const runs = engraveRuns(
      loops,
      img,
      options({ placement: box, spacing: 1 }),
    );
    // One line (y = 1), split in two over the white middle.
    expect(runs.length).toBe(2);
    expect(runs[1].linked).toBeFalse();
    // Each piece starts or ends at the surface by the white.
    expect(runs[0].points[runs[0].points.length - 1].z).toBeCloseTo(0);
    expect(runs[1].points[0].z).toBeCloseTo(0);

    // A white gap shorter than LIFT_OVER is carved through.
    const narrow = image(30, 1, (x) =>
      x >= 10 && x < 10 + LIFT_OVER - 2 ? 1 : 0,
    );
    expect(engraveRuns(loops, narrow, options({ placement: box })).length).toBe(
      1,
    );
  });

  it('leaves white out', () => {
    const white = image(1, 1, () => 1);
    expect(engraveRuns([square(10)], white, options())).toEqual([]);
  });

  it('drops points the depth runs straight through', () => {
    const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0, z: -x / 10 }));
    expect(simplifyDepths(points, 0.01)).toEqual([points[0], points[4]]);
    // A dip is kept.
    points[2].z = -1;
    expect(simplifyDepths(points, 0.01)).toContain(points[2]);
  });
});
