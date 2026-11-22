import { GCodeBuilder } from './gcode-builder';
import {
  GcodeListing,
  linesOfPoints,
  listingPaths,
  listingSections,
  listingTip,
} from './gcode-listing';
import { DEFAULT_GCODE_OPTIONS, GcodeOptions } from './gcode-options';
import { rotaryOf } from './rotary';
import { resolveStock } from './stock';
import { CamPath, CamPoint3 } from './types';

type Segment = { from: CamPoint3; to: CamPoint3; frame: string };

function segments(paths: CamPath[]): Segment[] {
  return paths.flatMap((path) =>
    path.points.slice(1).map((to, i) => ({
      from: path.points[i],
      to,
      frame: `${path.rotation ?? ''}|${path.wrapped ?? ''}|${path.flip ?? ''}`,
    })),
  );
}

function expectSameMoves(a: Segment[], b: Segment[]) {
  expect(a.length).toBe(b.length);
  a.forEach((segment, i) => {
    expect(segment.frame).withContext(`segment ${i}`).toBe(b[i].frame);
    for (const end of ['from', 'to'] as const) {
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(segment[end][axis])
          .withContext(`segment ${i} ${end} ${axis}`)
          .toBeCloseTo(b[i][end][axis], 2);
      }
    }
  });
}

const all = (listing: GcodeListing) =>
  listingPaths(listing, 0, listing.lines.length - 1);

describe('GCodeBuilder.toListing', () => {
  const options: Partial<GcodeOptions> = {
    ...DEFAULT_GCODE_OPTIONS,
    arcs: false,
  };
  const job = () =>
    new GCodeBuilder()
      .sourceOperationId('first')
      .useTool(1, 'end mill', 12000)
      .goToSafeHeight()
      .travelTo(10, 10)
      .plunge(-2)
      .carveTo(30, 10)
      .arcTo(30, 30, 1)
      .carveTo(10, 30, -3)
      .goToSafeHeight()
      .sourceOperationId('second')
      .useTool(2, 'drill', 8000)
      .drillCycle({
        x: 50,
        y: 50,
        depth: -5,
        retract: 1,
        peck: 0,
        chipBreak: false,
        dwell: 0,
      })
      .sourceOperationId('')
      .goToSafeHeight()
      .stopProgram();

  it('has the lines `build` writes', () => {
    for (const arcs of [false, true]) {
      const o = { ...options, arcs, offset: { x: 5, y: -3, z: 1 } };
      expect(job().toListing(o).lines.join('\n')).toBe(job().build(o));
    }
  });

  it('draws the moves where the preview does, whatever the zero', () => {
    // (A canned cycle is one line: drawn down its hole, not move by move.)
    const cuts = () =>
      GCodeBuilder.of(
        job().instructions.filter((i) => i.type !== 'drill-cycle'),
        true,
      );
    const paths = segments(cuts().toPaths(options));
    expectSameMoves(segments(all(cuts().toListing(options))), paths);
    expectSameMoves(
      segments(
        all(cuts().toListing({ ...options, offset: { x: 5, y: -3, z: 1 } })),
      ),
      paths,
    );
  });

  it('gives each line its move', () => {
    const listing = job().toListing(options);
    const line = listing.lines.indexOf('G1 X30 F1200');
    expect(line).toBeGreaterThan(0);
    const [path] = listingPaths(listing, line, line);
    expect(path.points).toEqual([
      { x: 10, y: 10, z: -2 },
      { x: 30, y: 10, z: -2 },
    ]);
    // A line that moves nothing: nothing drawn, the tool where it was.
    const comment = listing.lines.findIndex((l) => l.startsWith('; source'));
    expect(listingPaths(listing, comment, comment)).toEqual([]);
    expect(listingTip(listing, line)!.points).toEqual([
      { x: 30, y: 10, z: -2 },
    ]);
    // Every point reached belongs to the line that reaches it.
    const lines = linesOfPoints(listing);
    expect(lines[listing.ends[line]]).toBe(line);
  });

  it('follows an arc written as G2 / G3', () => {
    const listing = job().toListing({ ...options, arcs: true });
    const line = listing.lines.findIndex((l) => l.startsWith('G3 '));
    expect(line).toBeGreaterThan(0);
    const [path] = listingPaths(listing, line, line);
    expect(path.points.length).toBeGreaterThan(4);
    // Half a circle round (30, 20), radius 10.
    for (const p of path.points) {
      expect(Math.hypot(p.x - 30, p.y - 20)).toBeCloseTo(10, 2);
      expect(p.x).toBeGreaterThan(29.99);
    }
  });

  it('draws a canned cycle down its hole', () => {
    const o = { ...options, offset: { x: 5, y: 0, z: 0 } };
    const listing = job().toListing(o);
    const line = listing.lines.findIndex((l) => l.includes('G81'));
    expect(listing.lines[line]).toContain('X55 Y50');
    const [path] = listingPaths(listing, line, line);
    expect(path.points.slice(1)).toEqual([
      { x: 50, y: 50, z: 5 },
      { x: 50, y: 50, z: -5 },
      { x: 50, y: 50, z: 5 },
    ]);
  });

  it('says which operation lines belong to', () => {
    const listing = job().toListing(options);
    const sections = listingSections(listing);
    expect(sections.map((s) => s.operationId)).toEqual([
      '',
      'first',
      'second',
      '',
    ]);
    expect(listing.lines[sections[2].first]).toBe('; source-operation=second');
    expect(sections[3].last).toBe(listing.lines.length - 1);
  });

  it('keeps turned and wrapped moves in their frames', () => {
    const box = rotaryOf(
      resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'x',
        width: 100,
        height: 40,
        thickness: 20,
        x: 0,
        y: 0,
      }),
    )!;
    const cut = (angle: number, wrap = false) =>
      new GCodeBuilder()
        .rotate(angle, wrap)
        .travelTo(50, 20)
        .plunge(-1)
        .carveTo(60, 45)
        .goToSafeHeight();
    const turned = () =>
      GCodeBuilder.concatAll([cut(0), cut(90), cut(200, true)])
        .goToSafeHeight()
        .stopProgram();
    for (const offset of [undefined, { x: 1, y: 2, z: 3 }]) {
      const o = { ...options, rotary: box };
      expectSameMoves(
        segments(all(turned().toListing({ ...o, offset }))),
        segments(turned().toPaths(o)),
      );
    }
  });

  it('keeps moves on the back of a board in its frame', () => {
    const flipped = () =>
      new GCodeBuilder()
        .side(false, 'x')
        .travelTo(1, 1)
        .plunge(-1)
        .carveTo(5, 1)
        .side(true, 'x')
        .travelTo(2, 2)
        .plunge(-1)
        .carveTo(6, 2)
        .goToSafeHeight()
        .stopProgram();
    expectSameMoves(
      segments(all(flipped().toListing(options))),
      segments(flipped().toPaths(options)),
    );
  });
});
