import { ArcTolerance, fitArcs } from './arc-fit';
import { CamPoint, CamPolygon, CamShape } from './types';

/** A piece of an exported outline, from where the previous one ended. */
export type OutlineSegment =
  | { type: 'line'; to: CamPoint }
  | { type: 'arc'; to: CamPoint; center: CamPoint; clockwise: boolean }
  | { type: 'cubic'; c1: CamPoint; c2: CamPoint; to: CamPoint };

/** A polygon as lines, arcs and cubic Béziers. */
export type Outline = {
  start: CamPoint;
  segments: OutlineSegment[];
  close: boolean;
};

/** Turns sharper than this (radians) are corners: curves don't round them. */
const CORNER_ANGLE = (35 * Math.PI) / 180;
/** Coordinates are written in micrometres. */
const UNITS_PER_MM = 1000;
/** Drill points (single-point polygons) are drawn as circles this big. */
const POINT_RADIUS = 0.5;
/** Room round the drawing, in mm. */
const MARGIN = 0.5;
const STROKE_WIDTH = 0.1;

/**
 * The shapes as an SVG document in millimetres (1 user unit = 1 mm, Y up
 * as in the design), for a laser cutter or another program. Runs of points
 * that follow a circle become arcs and other smooth runs cubic Béziers,
 * within `tolerance` of the points.
 */
export function shapesToSvg(
  shapes: CamShape[],
  tolerance: ArcTolerance,
  title?: string,
): string {
  const polygons = shapes.flatMap((s) => s.polygons);
  const all = polygons.flatMap((p) => p.points);
  const dots = polygons.filter((p) => p.points.length === 1);
  if (!all.length) {
    return svgDocument(0, 0, '', title);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = MARGIN + (dots.length ? POINT_RADIUS : 0);
  // SVG's Y points down: flip, with the drawing's corner at the margin.
  const place = (p: CamPoint): CamPoint => ({
    x: p.x - minX + pad,
    y: maxY - p.y + pad,
  });

  const outlines = polygons
    .filter((p) => p.points.length > 1)
    .map((p) =>
      fitOutline({ ...p, points: p.points.map(place) }, tolerance, true),
    );
  const body = [
    outlines.length
      ? `<path d="${pathData(outlines)}" fill="none" stroke="#000" stroke-width="${STROKE_WIDTH}"/>`
      : '',
    ...dots.map((p) => {
      const at = place(p.points[0]);
      return `<circle cx="${mm(units(at.x))}" cy="${mm(units(at.y))}" r="${POINT_RADIUS}" fill="none" stroke="#000" stroke-width="${STROKE_WIDTH}"/>`;
    }),
  ]
    .filter(Boolean)
    .join('\n');
  return svgDocument(maxX - minX + 2 * pad, maxY - minY + 2 * pad, body, title);
}

function svgDocument(
  width: number,
  height: number,
  body: string,
  title?: string,
): string {
  const w = mm(units(width));
  const h = mm(units(height));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    ...(title ? [`<title>${escapeXml(title)}</title>`] : []),
    ...(body ? [body] : []),
    '</svg>',
    '',
  ].join('\n');
}

/**
 * A polygon as lines, arcs and Béziers. Corners are kept; between them,
 * arcs are used where they make a shorter path than Béziers alone (with
 * `arcs` on).
 */
export function fitOutline(
  polygon: CamPolygon,
  tolerance: ArcTolerance,
  arcs = true,
): Outline {
  let points = withoutRepeats(polygon.points);
  const close = polygon.close && points.length > 2;
  if (close && same(points[0], points[points.length - 1])) {
    points = points.slice(0, -1);
  }
  if (points.length < 2) {
    return { start: points[0], segments: [], close: false };
  }

  const corners = cornerIndices(points, close);
  if (close) {
    // Start at a corner (if there's one), so no curve is cut in two.
    const first = corners[0] ?? 0;
    points = [...points.slice(first), ...points.slice(0, first + 1)];
  }
  const last = points.length - 1;
  const breaks = close
    ? [
        0,
        ...corners.map((c) => c - (corners[0] ?? 0)).filter((c) => c > 0),
        last,
      ]
    : [0, ...corners, last];

  const segments: OutlineSegment[] = [];
  for (let k = 0; k < breaks.length - 1; k++) {
    const run = points.slice(breaks[k], breaks[k + 1] + 1);
    // A loop without corners: smooth where it starts and ends too.
    const loop = close && !corners.length;
    const tangent = loop ? unit(sub(points[1], points[last - 1])) : undefined;
    const curves = fitCurves(run, tolerance, tangent, tangent && neg(tangent));
    if (!arcs) {
      segments.push(...curves);
      continue;
    }
    const withArcs = fitRunWithArcs(run, tolerance);
    segments.push(
      ...(encodedLength(run[0], withArcs) < encodedLength(run[0], curves)
        ? withArcs
        : curves),
    );
  }

  // The closing line is drawn by the path's "z".
  const end = segments[segments.length - 1];
  if (close && end?.type === 'line' && segments.length > 1) {
    segments.pop();
  }
  return { start: points[0], segments, close };
}

/** Indices of the points where the outline turns sharply. */
function cornerIndices(points: CamPoint[], close: boolean): number[] {
  const n = points.length;
  const found: number[] = [];
  for (let i = close ? 0 : 1; i < (close ? n : n - 1); i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const turn = Math.abs(
      Math.atan2(cross(sub(b, a), sub(c, b)), dot(sub(b, a), sub(c, b))),
    );
    if (turn > CORNER_ANGLE) {
      found.push(i);
    }
  }
  return found;
}

/** Arcs where the points follow a circle, Béziers for the rest. */
function fitRunWithArcs(
  run: CamPoint[],
  tolerance: ArcTolerance,
): OutlineSegment[] {
  const segments: OutlineSegment[] = [];
  let lines: CamPoint[] = [run[0]];
  const flush = () => {
    if (lines.length > 1) {
      segments.push(...fitCurves(lines, tolerance));
    }
  };
  for (const move of fitArcs(run, tolerance)) {
    if (move.type === 'line') {
      lines.push(move.to);
    } else {
      flush();
      segments.push({
        type: 'arc',
        to: move.to,
        center: move.center,
        clockwise: move.clockwise,
      });
      lines = [move.to];
    }
  }
  flush();
  return segments;
}

/**
 * Cubic Béziers through the points (Schneider's algorithm, "An Algorithm
 * for Automatically Fitting Digitized Curves", Graphics Gems, 1990): each
 * curve is within `tolerance.points` of the points it stands for and
 * `tolerance.chords` of the segments between them; where one curve can't
 * do, the run is split at the worst point. Straight bits stay lines.
 * `tan1` / `tan2` are the directions out of the ends (into the run).
 */
function fitCurves(
  points: CamPoint[],
  tolerance: ArcTolerance,
  tan1?: CamPoint,
  tan2?: CamPoint,
): OutlineSegment[] {
  const out: OutlineSegment[] = [];
  const last = points.length - 1;
  fitRange(
    points,
    0,
    last,
    tan1 ?? unit(sub(points[1], points[0])),
    tan2 ?? unit(sub(points[last - 1], points[last])),
    tolerance,
    out,
  );
  return out;
}

function fitRange(
  points: CamPoint[],
  first: number,
  last: number,
  tan1: CamPoint,
  tan2: CamPoint,
  tolerance: ArcTolerance,
  out: OutlineSegment[],
) {
  if (last - first === 1) {
    out.push({ type: 'line', to: points[last] });
    return;
  }
  if (isStraight(points, first, last, tolerance.points)) {
    out.push({ type: 'line', to: points[last] });
    return;
  }

  let u = chordLengths(points, first, last);
  let split = (first + last) >> 1;
  // Far off: splitting does better than refining the parameters.
  let worst = 50;
  for (let attempt = 0; attempt < 8; attempt++) {
    const curve = bezierFor(points, first, last, u, tan1, tan2);
    const error = fitError(points, first, last, curve, u, tolerance);
    if (error.ratio <= 1) {
      out.push({ type: 'cubic', c1: curve[1], c2: curve[2], to: curve[3] });
      return;
    }
    split = error.index;
    // Refine only while it helps.
    if (error.ratio >= worst) break;
    worst = error.ratio;
    const better = reparameterize(points, first, last, u, curve);
    if (!better) break;
    u = better;
  }

  split = Math.min(last - 1, Math.max(first + 1, split));
  let center = sub(points[split - 1], points[split + 1]);
  if (!length(center)) center = sub(points[split - 1], points[split]);
  center = unit(center);
  fitRange(points, first, split, tan1, center, tolerance, out);
  fitRange(points, split, last, neg(center), tan2, tolerance, out);
}

/** Whether every point is within `tolerance` of the chord. */
function isStraight(
  points: CamPoint[],
  first: number,
  last: number,
  tolerance: number,
): boolean {
  for (let i = first + 1; i < last; i++) {
    if (segmentDistance(points[i], points[first], points[last]) > tolerance) {
      return false;
    }
  }
  return true;
}

/** Each point's parameter, by the distance along the polyline. */
function chordLengths(
  points: CamPoint[],
  first: number,
  last: number,
): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) {
    u.push(u[u.length - 1] + length(sub(points[i], points[i - 1])));
  }
  const total = u[u.length - 1];
  return u.map((v) => v / total);
}

type Cubic = [CamPoint, CamPoint, CamPoint, CamPoint];

/** The least-squares cubic with the given end directions. */
function bezierFor(
  points: CamPoint[],
  first: number,
  last: number,
  u: number[],
  tan1: CamPoint,
  tan2: CamPoint,
): Cubic {
  const p1 = points[first];
  const p2 = points[last];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const b = 1 - t;
    const b0 = b * b * b;
    const b1 = 3 * t * b * b;
    const b2 = 3 * t * t * b;
    const b3 = t * t * t;
    const a1 = scale(tan1, b1);
    const a2 = scale(tan2, b2);
    const rest = sub(points[i], add(scale(p1, b0 + b1), scale(p2, b2 + b3)));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, rest);
    x1 += dot(a2, rest);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1: number;
  let alpha2: number;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  } else {
    const c0 = c00 + c01;
    const c1 = c01 + c11;
    alpha1 = alpha2 =
      Math.abs(c0) > 1e-12 ? x0 / c0 : Math.abs(c1) > 1e-12 ? x1 / c1 : 0;
  }

  // Handles that point backwards or reach past the other end make loops:
  // fall back to a third of the chord (Wu & Barsky's heuristic).
  const chord = length(sub(p2, p1));
  const tiny = 1e-6 * chord;
  if (
    alpha1 < tiny ||
    alpha2 < tiny ||
    alpha1 > 2 * chord ||
    alpha2 > 2 * chord
  ) {
    alpha1 = alpha2 = chord / 3;
  }
  return [p1, add(p1, scale(tan1, alpha1)), add(p2, scale(tan2, alpha2)), p2];
}

/**
 * How far the curve is from the points and the segments between them,
 * relative to what's allowed (≤ 1 fits), and the point to split at.
 */
function fitError(
  points: CamPoint[],
  first: number,
  last: number,
  curve: Cubic,
  u: number[],
  tolerance: ArcTolerance,
): { ratio: number; index: number } {
  let ratio = 0;
  let index = (first + last) >> 1;
  for (let i = first; i <= last; i++) {
    const k = i - first;
    const off =
      length(sub(bezierAt(curve, u[k]), points[i])) / tolerance.points;
    if (off > ratio) {
      ratio = off;
      index = i;
    }
    if (i < last) {
      // The curve between two points shouldn't bulge off the segment.
      const middle = bezierAt(curve, (u[k] + u[k + 1]) / 2);
      const bulge =
        segmentDistance(middle, points[i], points[i + 1]) / tolerance.chords;
      if (bulge > ratio) {
        ratio = bulge;
        index = i === first ? i + 1 : i;
      }
    }
  }
  return { ratio, index };
}

/**
 * Better parameters for the points (a Newton–Raphson step each towards the
 * nearest point of the curve), or null if they'd no longer be in order.
 */
function reparameterize(
  points: CamPoint[],
  first: number,
  last: number,
  u: number[],
  curve: Cubic,
): number[] | null {
  const next = u.map((t, k) => {
    const p = points[first + k];
    const d = sub(bezierAt(curve, t), p);
    const d1 = derivativeAt(curve, t);
    const d2 = secondDerivativeAt(curve, t);
    const denominator = dot(d1, d1) + dot(d, d2);
    return Math.abs(denominator) < 1e-12 ? t : t - dot(d, d1) / denominator;
  });
  for (let k = 1; k < next.length; k++) {
    if (!(next[k] > next[k - 1])) return null;
  }
  return next;
}

function bezierAt([p0, p1, p2, p3]: Cubic, t: number): CamPoint {
  const b = 1 - t;
  const b0 = b * b * b;
  const b1 = 3 * t * b * b;
  const b2 = 3 * t * t * b;
  const b3 = t * t * t;
  return {
    x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
    y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
  };
}

function derivativeAt([p0, p1, p2, p3]: Cubic, t: number): CamPoint {
  const b = 1 - t;
  return add(
    add(scale(sub(p1, p0), 3 * b * b), scale(sub(p2, p1), 6 * t * b)),
    scale(sub(p3, p2), 3 * t * t),
  );
}

function secondDerivativeAt([p0, p1, p2, p3]: Cubic, t: number): CamPoint {
  return add(
    scale(add(sub(p2, scale(p1, 2)), p0), 6 * (1 - t)),
    scale(add(sub(p3, scale(p2, 2)), p1), 6 * t),
  );
}

/**
 * SVG path data for the outlines: relative commands, coordinates rounded
 * to micrometres (each move measured from the rounded position, so the
 * rounding doesn't add up), repeated commands left out.
 */
export function pathData(outlines: Outline[]): string {
  let d = '';
  /** The command a bare list of numbers would continue. */
  let command = '';
  let at = { x: 0, y: 0 };
  // Numbers are in micrometres; strings (arc flags) are written as they are.
  const emit = (letter: string, ...values: Array<number | string>) => {
    const repeat = letter === command;
    if (!repeat) d += letter;
    values.forEach((value, i) => {
      const text = typeof value === 'string' ? value : mm(value);
      d += (i > 0 || repeat) && !text.startsWith('-') ? ` ${text}` : text;
    });
    // After a move, more pairs are lines.
    command = letter === 'M' ? 'L' : letter === 'm' ? 'l' : letter;
  };

  for (const outline of outlines) {
    if (!outline.segments.length) continue;
    const start = unitsOf(outline.start);
    if (d) emit('m', start.x - at.x, start.y - at.y);
    else emit('M', start.x, start.y);
    at = start;
    for (const segment of outline.segments) {
      const to = unitsOf(segment.to);
      const dx = to.x - at.x;
      const dy = to.y - at.y;
      if (dx === 0 && dy === 0) continue;
      switch (segment.type) {
        case 'line':
          if (dy === 0) emit('h', dx);
          else if (dx === 0) emit('v', dy);
          else emit('l', dx, dy);
          break;
        case 'cubic': {
          const c1 = unitsOf(segment.c1);
          const c2 = unitsOf(segment.c2);
          emit('c', c1.x - at.x, c1.y - at.y, c2.x - at.x, c2.y - at.y, dx, dy);
          break;
        }
        case 'arc': {
          const from = { x: at.x / UNITS_PER_MM, y: at.y / UNITS_PER_MM };
          const end = { x: to.x / UNITS_PER_MM, y: to.y / UNITS_PER_MM };
          const radius =
            (length(sub(from, segment.center)) +
              length(sub(end, segment.center))) /
            2;
          // Never shorter than half the chord (it would be stretched anyway).
          const r = Math.max(units(radius), Math.ceil(Math.hypot(dx, dy) / 2));
          const sweep = sweepAngle(
            from,
            end,
            segment.center,
            segment.clockwise,
          );
          // The points are in SVG's coordinates already: its sweep flag 1
          // turns the positive way there, i.e. counter-clockwise by the maths.
          emit(
            'a',
            r,
            r,
            '0',
            sweep > Math.PI ? '1' : '0',
            segment.clockwise ? '0' : '1',
            dx,
            dy,
          );
          break;
        }
      }
      at = to;
    }
    if (outline.close) {
      emit('z');
      at = start;
    }
  }
  return d;
}

/** How far the arc turns round `center`, from `from` to `to`. */
function sweepAngle(
  from: CamPoint,
  to: CamPoint,
  center: CamPoint,
  clockwise: boolean,
): number {
  const a = Math.atan2(from.y - center.y, from.x - center.x);
  const b = Math.atan2(to.y - center.y, to.x - center.x);
  let ccw = b - a;
  while (ccw < 0) ccw += 2 * Math.PI;
  while (ccw >= 2 * Math.PI) ccw -= 2 * Math.PI;
  return clockwise ? 2 * Math.PI - ccw : ccw;
}

/** Roughly how long the segments' path data is (to pick the shorter fit). */
function encodedLength(start: CamPoint, segments: OutlineSegment[]): number {
  return pathData([{ start, segments, close: false }]).length;
}

function units(mmValue: number): number {
  return Math.round(mmValue * UNITS_PER_MM);
}

function unitsOf(p: CamPoint): CamPoint {
  return { x: units(p.x), y: units(p.y) };
}

/** Micrometres written as millimetres, as short as they go. */
function mm(value: number): string {
  return String(value / UNITS_PER_MM);
}

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}

function withoutRepeats(points: CamPoint[]): CamPoint[] {
  return points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
}

function same(a: CamPoint, b: CamPoint): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function segmentDistance(p: CamPoint, a: CamPoint, b: CamPoint): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return length(sub(p, add(a, scale(ab, t))));
}

const add = (a: CamPoint, b: CamPoint) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: CamPoint, b: CamPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: CamPoint, s: number) => ({ x: a.x * s, y: a.y * s });
const neg = (a: CamPoint) => ({ x: -a.x, y: -a.y });
const dot = (a: CamPoint, b: CamPoint) => a.x * b.x + a.y * b.y;
const cross = (a: CamPoint, b: CamPoint) => a.x * b.y - a.y * b.x;
const length = (a: CamPoint) => Math.hypot(a.x, a.y);
const unit = (a: CamPoint) => {
  const l = length(a);
  return l ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
