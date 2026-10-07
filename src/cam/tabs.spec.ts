import { GCodeBuilder, PathInstruction } from './gcode-builder';
import { keepTabs, placeTabs, TabPlacement, tabsNear, tabsOf } from './tabs';
import { CamPoint, CamShape, CamTab } from './types';
import { polarArray } from '../worker/work/shape-transforms';

const square = (x: number, y: number, size: number): CamPoint[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const shape = (...polygons: CamPoint[][]): CamShape[] => [
  {
    sourceShapeId: 's',
    polygons: polygons.map((points) => ({ points, close: true })),
  },
];

const placement = (p: Partial<TabPlacement> = {}): TabPlacement => ({
  on: 'contours',
  side: 'outside',
  count: 4,
  width: 6,
  length: 10,
  depth: 15,
  offset: 0,
  ...p,
});

const box = (tab: CamTab) => {
  const xs = tab.points.map((p) => p.x);
  const ys = tab.points.map((p) => p.y);
  return {
    minX: +Math.min(...xs).toFixed(6),
    maxX: +Math.max(...xs).toFixed(6),
    minY: +Math.min(...ys).toFixed(6),
    maxY: +Math.max(...ys).toFixed(6),
  };
};

describe('placeTabs', () => {
  it('spaces tabs evenly round each outline, reaching out of it', () => {
    const [result] = placeTabs(shape(square(0, 0, 100)), placement());
    expect(result.tabs!.length).toBe(4);
    // The first is in the middle of the first edge (the bottom).
    expect(box(result.tabs![0])).toEqual({
      minX: 47,
      maxX: 53,
      minY: -10,
      maxY: 0,
    });
    expect(result.tabs!.every((t) => t.top === -15)).toBeTrue();
  });

  it('reaches out of the outline whichever way it runs', () => {
    const [result] = placeTabs(shape(square(0, 0, 100).reverse()), placement());
    // Reversed, the first edge runs along the top.
    expect(box(result.tabs![0])).toEqual({
      minX: 47,
      maxX: 53,
      minY: 100,
      maxY: 110,
    });
  });

  it('reaches into the shape, or both ways', () => {
    const [inside] = placeTabs(
      shape(square(0, 0, 100)),
      placement({ side: 'inside' }),
    );
    expect(box(inside.tabs![0]).minY).toBe(0);
    expect(box(inside.tabs![0]).maxY).toBe(10);
    const [both] = placeTabs(
      shape(square(0, 0, 100)),
      placement({ side: 'both' }),
    );
    expect(box(both.tabs![0]).minY).toBe(-10);
    expect(box(both.tabs![0]).maxY).toBe(10);
  });

  it('puts tabs on holes only when asked, reaching into the hole', () => {
    const frame = shape(square(0, 0, 100), square(40, 40, 20));
    expect(placeTabs(frame, placement({ count: 1 }))[0].tabs!.length).toBe(1);
    const [holes] = placeTabs(frame, placement({ on: 'holes', length: 5 }));
    expect(holes.tabs!.length).toBe(4);
    // On the hole's bottom edge, reaching up into it.
    expect(box(holes.tabs![0])).toEqual({
      minX: 47,
      maxX: 53,
      minY: 40,
      maxY: 45,
    });
    const [both] = placeTabs(frame, placement({ on: 'both', count: 2 }));
    expect(both.tabs!.length).toBe(4);
  });

  it('moves the tabs round by the offset', () => {
    const [result] = placeTabs(
      shape(square(0, 0, 100)),
      placement({ offset: 100 }),
    );
    // From the middle of the bottom to the middle of the right side.
    expect(box(result.tabs![0])).toEqual({
      minX: 100,
      maxX: 110,
      minY: 47,
      maxY: 53,
    });
  });

  it('puts a tab on the line nearest each point given', () => {
    // A flat bottom and a rounded top: tabs only where they're asked for.
    const arch = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      ...Array.from({ length: 31 }, (_, k) => ({
        x: 50 + 50 * Math.cos((Math.PI * k) / 30),
        y: 50 * Math.sin((Math.PI * k) / 30),
      })),
    ];
    const [result] = placeTabs(
      shape(arch),
      placement({
        at: [
          { x: 30, y: -20 },
          { x: 70, y: 3 },
        ],
      }),
    );
    expect(result.tabs!.map(box)).toEqual([
      { minX: 27, maxX: 33, minY: -10, maxY: 0 },
      { minX: 67, maxX: 73, minY: -10, maxY: 0 },
    ]);
  });

  it('only puts tabs at points on the loops asked for', () => {
    const frame = shape(square(0, 0, 100), square(40, 40, 20));
    // Nearest the hole, but holes don't get tabs: on the outline instead.
    const [outline] = placeTabs(frame, placement({ at: [{ x: 50, y: 38 }] }));
    expect(box(outline.tabs![0])).toEqual({
      minX: 47,
      maxX: 53,
      minY: -10,
      maxY: 0,
    });
    const [hole] = placeTabs(
      frame,
      placement({ on: 'both', length: 5, at: [{ x: 50, y: 38 }] }),
    );
    expect(box(hole.tabs![0])).toEqual({
      minX: 47,
      maxX: 53,
      minY: 40,
      maxY: 45,
    });
    const input = shape(square(0, 0, 100));
    expect(placeTabs(input, placement({ at: [] }))).toBe(input);
  });

  it('places nothing without a count, width or length', () => {
    const input = shape(square(0, 0, 100));
    expect(placeTabs(input, placement({ count: 0 }))).toBe(input);
    expect(placeTabs(input, placement({ width: 0 }))).toBe(input);
    expect(placeTabs(input, placement({ length: 0 }))).toBe(input);
  });

  it('copies the tabs with the shape', () => {
    const tabbed = placeTabs(shape(square(0, 0, 10)), placement());
    const copies = polarArray(tabbed, {
      type: 'polar',
      polarCount: 2,
      polarAngle: 360,
      polarAround: 'point',
      polarX: 50,
      polarY: 5,
      polarRotate: true,
    });
    expect(copies.length).toBe(2);
    // Turned half way round about (50, 5): the tab on the copy's bottom
    // edge is now on its top edge, reaching up.
    expect(box(copies[1].tabs![0])).toEqual({
      minX: 92,
      maxX: 98,
      minY: 10,
      maxY: 20,
    });
  });
});

describe('tabsOf / tabsNear', () => {
  it('lists each tab once', () => {
    const [a] = placeTabs(shape(square(0, 0, 100)), placement());
    expect(tabsOf([a, { ...a }]).length).toBe(4);
  });

  it('keeps the tabs a tool could reach', () => {
    const tab: CamTab = { points: square(0, 0, 10), top: -5 };
    expect(
      tabsNear([tab], { minX: 12, minY: 0, maxX: 20, maxY: 5 }, 3),
    ).toEqual([tab]);
    expect(
      tabsNear([tab], { minX: 14, minY: 0, maxX: 20, maxY: 5 }, 3),
    ).toEqual([]);
    expect(tabsNear([tab], null, 3)).toEqual([]);
  });
});

describe('keepTabs', () => {
  // Bottom edge of a 100 mm square cut from outside by a 6 mm bit.
  const tab: CamTab = {
    points: [
      { x: 45, y: -10 },
      { x: 55, y: -10 },
      { x: 55, y: 0 },
      { x: 45, y: 0 },
    ],
    top: -8,
  };
  const moves = (builder: GCodeBuilder) =>
    builder.instructions.map((i) => round(i));

  it('goes over a tab and back down after it', () => {
    const builder = new GCodeBuilder()
      .goToSafeHeight()
      .travelTo(0, -3)
      .plunge(-10)
      .carveTo(100, -3);
    expect(moves(keepTabs(builder, [tab], 3))).toEqual([
      { type: 'safety-height' },
      { type: 'travel', to: { x: 0, y: -3 } },
      { type: 'plunge', depth: -10 },
      { type: 'carve', to: { x: 42, y: -3 } },
      { type: 'plunge', depth: -8 },
      { type: 'carve', to: { x: 58, y: -3 } },
      { type: 'plunge', depth: -10 },
      { type: 'carve', to: { x: 100, y: -3 } },
    ]);
  });

  it('leaves moves clear of the tabs, or above them, as they are', () => {
    const builder = new GCodeBuilder()
      .goToSafeHeight()
      .travelTo(0, 10)
      .plunge(-10)
      .carveTo(100, 10)
      .goToSafeHeight()
      .travelTo(0, -3)
      .plunge(-5)
      .carveTo(100, -3);
    expect(keepTabs(builder, [tab], 3).instructions).toEqual(
      builder.instructions,
    );
  });

  it('cuts a ramp short where it would go into a tab', () => {
    const builder = new GCodeBuilder()
      .goToSafeHeight()
      .travelTo(0, -3)
      .plunge(0)
      .carveTo(100, -3, -10);
    // It gets down to the tab's top over it.
    expect(moves(keepTabs(builder, [{ ...tab, top: -5 }], 3))).toEqual([
      { type: 'safety-height' },
      { type: 'travel', to: { x: 0, y: -3 } },
      { type: 'plunge', depth: 0 },
      { type: 'carve', to: { x: 42, y: -3 }, z: -4.2 },
      { type: 'carve', to: { x: 50, y: -3 }, z: -5 },
      { type: 'carve', to: { x: 58, y: -3 } },
      { type: 'plunge', depth: -5.8 },
      { type: 'carve', to: { x: 100, y: -3 }, z: -10 },
    ]);
  });

  it('stops plunges and drilling at the top of a tab', () => {
    const builder = new GCodeBuilder()
      .goToSafeHeight()
      .travelTo(50, -3)
      .plunge(-10)
      .carveTo(60, -3)
      .goToSafeHeight()
      .drillCycle({
        x: 50,
        y: -5,
        depth: -12,
        retract: 2,
        peck: 0,
        chipBreak: false,
        dwell: 0,
      })
      .drillCycle({
        x: 50,
        y: -5,
        depth: -12,
        retract: -9,
        peck: 0,
        chipBreak: false,
        dwell: 0,
      });
    const kept = moves(keepTabs(builder, [tab], 3));
    expect(kept.slice(0, 6)).toEqual([
      { type: 'safety-height' },
      { type: 'travel', to: { x: 50, y: -3 } },
      { type: 'plunge', depth: -8 },
      { type: 'carve', to: { x: 58, y: -3 } },
      { type: 'plunge', depth: -10 },
      { type: 'carve', to: { x: 60, y: -3 } },
    ]);
    expect(kept[7]).toEqual(
      jasmine.objectContaining({ type: 'drill-cycle', depth: -8 }),
    );
    // The second hole starts below the tab's top: nothing left to drill.
    expect(kept.length).toBe(8);
  });
});

/** An instruction with its numbers rounded, to compare. */
function round(i: PathInstruction): PathInstruction {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  switch (i.type) {
    case 'carve':
      return i.z === undefined
        ? { type: 'carve', to: { x: r(i.to.x), y: r(i.to.y) } }
        : { type: 'carve', to: { x: r(i.to.x), y: r(i.to.y) }, z: r(i.z) };
    case 'plunge':
      return { type: 'plunge', depth: r(i.depth) };
    default:
      return i;
  }
}
