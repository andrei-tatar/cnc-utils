import { checkClearances } from './clearance';
import { CamPath, CamPoint3 } from './types';

const stock = { minX: 0, minY: 0, maxX: 60, maxY: 60, top: 0, bottom: -20 };
const path = (
  type: 'carve' | 'travel',
  points: Array<[number, number, number]>,
  sourceOperationId = 'o',
): CamPath => ({
  type,
  sourceShapeId: 's',
  sourceOperationId,
  points: points.map(([x, y, z]): CamPoint3 => ({ x, y, z })),
});
const endMill = { bitType: 'end-mill', diameter: 6 };

describe('checkClearances', () => {
  it('flags rapids into uncut material, not through what was cut', () => {
    const paths = [
      path('carve', [
        [10, 10, 0],
        [10, 10, -5],
        [40, 10, -5],
      ]),
      // Back along the slot it cut: clear.
      path('travel', [
        [40, 10, -5],
        [10, 10, -5],
      ]),
      // Across uncut stock at the slot's depth.
      path('travel', [
        [10, 10, -5],
        [10, 40, -5],
      ]),
      // High above it.
      path('travel', [
        [10, 40, 5],
        [50, 50, 5],
      ]),
    ];
    const { problems } = checkClearances(paths, { o: endMill }, stock, 35);
    expect(problems.length).toBe(1);
    expect(problems[0]).toEqual(
      jasmine.objectContaining({ operationId: 'o', kind: 'rapid', count: 1 }),
    );
    expect(problems[0].depth).toBeCloseTo(5, 1);
  });

  it('lets a drill rapid back down into its own hole', () => {
    const drill = { bitType: 'drill', diameter: 6, pointAngle: 118 };
    const paths = [
      path('carve', [
        [30, 30, 0],
        [30, 30, -10],
      ]),
      path('travel', [
        [30, 30, -10],
        [30, 30, 2],
        [30, 30, -9.7],
      ]),
    ];
    expect(checkClearances(paths, { o: drill }, stock, 35).problems).toEqual(
      [],
    );
  });

  it('finds uncut material above the flutes, unless cleared first', () => {
    const flutes = { ...endMill, fluteLength: 4 };
    const slot = path(
      'carve',
      [
        [10, 30, 0],
        [10, 30, -6],
        [50, 30, -6],
      ],
      'deep',
    );
    const alone = checkClearances([slot], { deep: flutes }, stock, 35);
    expect(alone.shankChecked).toEqual(['deep']);
    expect(alone.problems.map((p) => p.kind)).toEqual(['shank']);
    expect(alone.problems[0].depth).toBeCloseTo(2, 1);
    // A wide pocket 3 deep first: the shank only meets cleared space.
    const pocket: CamPath[] = [];
    for (let y = 18; y <= 42; y += 4) {
      pocket.push(
        path(
          'carve',
          [
            [2, y, -3],
            [58, y, -3],
          ],
          'pocket',
        ),
      );
    }
    const cleared = checkClearances(
      [...pocket, slot],
      { deep: flutes, pocket: endMill },
      stock,
      35,
    );
    expect(cleared.problems).toEqual([]);
  });

  it('finds the collet nut coming down onto the material', () => {
    const short = { ...endMill, stickout: 10 };
    const deep = path('carve', [
      [30, 30, 0],
      [30, 30, -12],
      [31, 30, -12],
    ]);
    const { problems } = checkClearances([deep], { o: short }, stock, 35);
    expect(problems.map((p) => p.kind)).toEqual(['holder']);
    expect(problems[0].depth).toBeCloseTo(2, 1);
    // Sticking out far enough: clear.
    expect(
      checkClearances([deep], { o: { ...endMill, stickout: 20 } }, stock, 35)
        .problems,
    ).toEqual([]);
  });

  it('checks nothing with the stock turned', () => {
    const turned = {
      ...path('travel', [
        [0, 0, -5],
        [50, 50, -5],
      ]),
      rotation: 90,
    };
    expect(
      checkClearances([turned], { o: endMill }, stock, 35).problems,
    ).toEqual([]);
  });
});
