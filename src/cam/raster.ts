import { CamPoint } from './types';
import { getDistance } from '../util';

const EPS = 1e-9;

export type Axis = 'x' | 'y';

/** One raster line: where it is across the axis, and its stretches inside. */
export type RasterLine = {
  normal: number;
  segments: Array<{ from: number; to: number }>;
};

/**
 * Raster lines running `along` the axis across the area inside `loops`
 * (closed, even-odd), evenly spaced at most `stepOver` apart. The lines on
 * the very edges are left out: a pass round the outline cuts there.
 */
export function rasterLines(
  loops: CamPoint[][],
  along: Axis,
  stepOver: number,
): RasterLine[] {
  const normal = across(along);
  let min = Infinity,
    max = -Infinity;
  for (const p of loops.flat()) {
    min = Math.min(min, p[normal]);
    max = Math.max(max, p[normal]);
  }
  if (!(max > min) || !(stepOver > 0)) {
    return [];
  }

  const count = Math.ceil((max - min) / stepOver - EPS);
  const spacing = (max - min) / count;
  const lines: RasterLine[] = [];
  for (let i = 1; i < count; i++) {
    const c = min + spacing * i;
    const crossings: number[] = [];
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k];
        const b = loop[(k + 1) % loop.length];
        // Half-open, so a line through a vertex counts it once.
        if (a[normal] <= c !== b[normal] <= c) {
          const t = (c - a[normal]) / (b[normal] - a[normal]);
          crossings.push(a[along] + t * (b[along] - a[along]));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    const segments: RasterLine['segments'] = [];
    for (let j = 0; j + 1 < crossings.length; j += 2) {
      segments.push({ from: crossings[j], to: crossings[j + 1] });
    }
    if (segments.length) {
      lines.push({ normal: c, segments });
    }
  }
  return lines;
}

/**
 * The raster lines as paths to cut, starting near `start`.
 * Zig-zag: each path goes back and forth over as many lines as it can,
 * stepping over to the next line where that stays inside `loops`.
 * One way: every line on its own, all cut the same way (towards +axis).
 */
export function rasterPaths(
  lines: RasterLine[],
  loops: CamPoint[][],
  along: Axis,
  start: CamPoint,
  oneWay: boolean,
): CamPoint[][] {
  const point = (normal: number, value: number): CamPoint =>
    along === 'x' ? { x: value, y: normal } : { x: normal, y: value };

  if (oneWay) {
    return lines.flatMap((line) =>
      line.segments.map((s) => [
        point(line.normal, s.from),
        point(line.normal, s.to),
      ]),
    );
  }

  const remaining = lines.map((line) => [...line.segments]);
  const paths: CamPoint[][] = [];
  let current = start;
  while (true) {
    let index = remaining.findIndex((segments) => segments.length);
    if (index < 0) {
      break;
    }

    // Into the nearest end of the nearest stretch on the first line left.
    const normal = lines[index].normal;
    let best = { segment: 0, reversed: false, distance: Infinity };
    remaining[index].forEach((s, i) => {
      for (const reversed of [false, true]) {
        const distance = getDistance(
          current,
          point(normal, reversed ? s.to : s.from),
        );
        if (distance < best.distance) {
          best = { segment: i, reversed, distance };
        }
      }
    });
    const [first] = remaining[index].splice(best.segment, 1);
    let end = best.reversed ? first.from : first.to;
    const path = [
      point(normal, best.reversed ? first.to : first.from),
      point(normal, end),
    ];

    // Step over to the next line, onto the stretch whose end is nearest.
    while (index + 1 < lines.length) {
      const next = lines[index + 1].normal;
      const here = path[path.length - 1];
      let step = { segment: -1, reversed: false, distance: Infinity };
      for (const [i, s] of remaining[index + 1].entries()) {
        const reversed = Math.abs(s.to - end) < Math.abs(s.from - end);
        const target = point(next, reversed ? s.to : s.from);
        const distance = getDistance(here, target);
        if (distance < step.distance && staysInside(loops, here, target)) {
          step = { segment: i, reversed, distance };
        }
      }
      if (step.segment < 0) {
        break;
      }
      const { segment, reversed } = step;
      const [s] = remaining[index + 1].splice(segment, 1);
      end = reversed ? s.from : s.to;
      path.push(point(next, reversed ? s.to : s.from), point(next, end));
      index++;
    }

    paths.push(path);
    current = path[path.length - 1];
  }
  return paths;
}

/**
 * Whether the straight move from `a` to `b` stays inside `loops` (on the
 * edge counts as inside), so the tool can go there without leaving the area.
 */
export function staysInside(
  loops: CamPoint[][],
  a: CamPoint,
  b: CamPoint,
  tolerance = 1e-4,
): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (!insideOrOn(loops, mid, tolerance)) {
    return false;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < tolerance) {
    return true;
  }
  // Crossings within `tolerance` of either end are where it starts or ends
  // on the edge.
  const margin = tolerance / length;
  for (const loop of loops) {
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k];
      const q = loop[(k + 1) % loop.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const d = dx * ey - dy * ex;
      if (Math.abs(d) < EPS) {
        continue;
      }
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / d;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / d;
      if (t > margin && t < 1 - margin && u >= 0 && u <= 1) {
        return false;
      }
    }
  }
  return true;
}

function insideOrOn(loops: CamPoint[][], p: CamPoint, tolerance: number) {
  let inside = false;
  for (const loop of loops) {
    for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) {
      const a = loop[j];
      const b = loop[k];
      if (distanceToSegment(p, a, b) <= tolerance) {
        return true;
      }
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function distanceToSegment(p: CamPoint, a: CamPoint, b: CamPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0
      ? Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
        )
      : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function across(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x';
}
