import { fitArcs } from './arc-fit';
import { GCodeBuilder } from './gcode-builder';
import { CamPoint } from './types';

function circlePoints(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  count: number,
): CamPoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / count;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const TOLERANCE = { points: 0.005, chords: 0.01 };

describe('fitArcs', () => {
  it('turns points along a circle into one arc', () => {
    const points = circlePoints(10, 5, 20, 0, Math.PI / 2, 40);
    const moves = fitArcs(points, TOLERANCE);
    expect(moves.length).toBe(1);
    const [arc] = moves;
    expect(arc.type).toBe('arc');
    if (arc.type !== 'arc') return;
    expect(arc.center.x).toBeCloseTo(10, 6);
    expect(arc.center.y).toBeCloseTo(5, 6);
    expect(arc.clockwise).toBeFalse();
    expect(arc.to).toEqual(points[points.length - 1]);
  });

  it('tells clockwise from counter-clockwise', () => {
    const points = circlePoints(0, 0, 10, Math.PI, 0, 60);
    const [arc] = fitArcs(points, TOLERANCE);
    expect(arc.type === 'arc' && arc.clockwise).toBeTrue();
  });

  it('keeps straight lines as lines', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 * i }));
    const moves = fitArcs(points, TOLERANCE);
    expect(moves.every((m) => m.type === 'line')).toBeTrue();
    expect(moves.length).toBe(19);
  });

  it('splits a full circle into arcs short of a whole turn', () => {
    const points = circlePoints(0, 0, 5, 0, 2 * Math.PI, 200);
    const moves = fitArcs(points, TOLERANCE);
    expect(moves.length).toBeGreaterThan(1);
    expect(moves.length).toBeLessThan(5);
    expect(moves[moves.length - 1].to).toEqual(points[points.length - 1]);
  });

  it('follows a square with rounded corners line, arc, line', () => {
    const points: CamPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      ...circlePoints(10, 5, 5, -Math.PI / 2, Math.PI / 2, 30).slice(1),
      { x: 0, y: 10 },
    ];
    const moves = fitArcs(points, TOLERANCE);
    expect(moves.map((m) => m.type)).toEqual(['line', 'arc', 'line']);
  });
});

describe('GCodeBuilder arcs', () => {
  function circleProgram() {
    const b = new GCodeBuilder().travelTo(20, 0).plunge(-1);
    for (const p of circlePoints(0, 0, 20, 0, Math.PI, 100).slice(1)) {
      b.carveTo(p.x, p.y);
    }
    return b;
  }

  it('writes cuts along a circle as G3 with a consistent radius', () => {
    const gcode = circleProgram().build({ arcs: true, header: false });
    const arcLines = gcode.split('\n').filter((l) => /^G[23] /.test(l));
    expect(arcLines.length).toBe(1);
    const [, x, y, i, j] = arcLines[0].match(
      /^G3 X(\S+) Y(\S+) I(\S+) J(\S+)/,
    )!;
    // Start at (20, 0): both ends 20 from the centre.
    const cx = 20 + +i;
    const cy = 0 + +j;
    expect(Math.hypot(20 - cx, 0 - cy)).toBeCloseTo(
      Math.hypot(+x - cx, +y - cy),
      3,
    );
    expect(+x).toBeCloseTo(-20, 2);
  });

  it('writes lines only when arcs are off', () => {
    const gcode = circleProgram().build({ arcs: false, header: false });
    expect(gcode).not.toMatch(/^G[23] /m);
    expect(gcode.split('\n').filter((l) => l.startsWith('G1')).length).toBe(
      101,
    );
  });

  it('keeps the preview paths as the original points', () => {
    const paths = circleProgram().toPaths({ arcs: true });
    const carve = paths.filter((p) => p.type === 'carve');
    expect(carve.reduce((n, p) => n + p.points.length, 0)).toBeGreaterThan(100);
  });

  it('keeps moves in order around arcs', () => {
    const b = circleProgram().goToSafeHeight().travelTo(0, 0).stopProgram();
    const lines = b.build({ arcs: true, header: false }).split('\n');
    const arcAt = lines.findIndex((l) => l.startsWith('G3'));
    const retractAt = lines.findIndex((l) => l.startsWith('G0 Z10'));
    expect(arcAt).toBeGreaterThan(0);
    expect(retractAt).toBeGreaterThan(arcAt);
  });
});

describe('GCodeBuilder.pack', () => {
  it('round-trips every instruction', () => {
    const b = new GCodeBuilder()
      .sourceOperationId('op')
      .useTool(1, 'tool', 1000)
      .travelTo(1, 2)
      .plunge(-3)
      .carveTo(4, 5)
      .carveTo(6, 7, -8)
      .pause()
      .goToSafeHeight();
    const unpacked = GCodeBuilder.unpack(GCodeBuilder.pack(b));
    expect(unpacked.build()).toEqual(b.build());
    expect(unpacked.isAtSafetyHeight).toBeTrue();
  });
});
