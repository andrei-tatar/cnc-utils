import { CamPoint, CamPolygon, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  decimals,
  GeometrySettings,
  precision,
  useGeometry,
} from '../../cam/geometry';
import { ShapePart, filledOutlines, holeSide } from '../../cam/vcarve-geometry';
import { alongLoop, arcTo, enterCut, Resume, startingAt } from '../../cam/ramp';
import { applyTransform } from './apply-transform';
import { getDistance } from '../../util';

const EPS = 1e-6;

type Tab = { start: number; end: number };

export async function routeProfile(
  input: CamShape[],
  options: {
    toolSize: number;
    side: 'outside' | 'inside' | 'on-line';
    direction: 'climb' | 'conventional';
    /** Keeps the cut this much further from the material (mm). */
    leaveStock?: number;
    startDepth: number;
    depthPerStep: number;
    steps: number;
    tabsEnabled: boolean;
    tabCount: number;
    tabWidth: number;
    tabHeight: number;
    /** Moves all tabs this far along the toolpath (mm). */
    tabOffset?: number;
    /** Which part of the shape to profile. */
    mode?: ShapePart;
    /** Ramp down into each pass at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
    /** How precisely to work (see GeometrySettings). */
    geometry?: GeometrySettings;
  },
): Promise<GCodeBuilder> {
  useGeometry(options.geometry);
  const builder = new GCodeBuilder();
  const sourceShapeId = input?.[0]?.sourceShapeId;
  builder.sourceShapeId(sourceShapeId);

  const closed = input
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && p.points.length > 2)
    .map((p) => p.points);
  if (options.mode === 'contours') {
    // Holes ignored: profile the filled outer outlines (and any open paths).
    const open = input.flatMap((s) => s.polygons).filter((p) => !p.close);
    const filled = (await filledOutlines(closed)).map((points): CamPolygon => ({
      points,
      close: true,
    }));
    input = [{ sourceShapeId, polygons: [...filled, ...open] }];
  }

  // Offset the outline by half the tool diameter so the cutting edge lands on
  // the shape boundary, plus any stock left on the wall. 'on-line' rides the
  // path itself (no compensation, no material side to leave stock on).
  const clearance = options.toolSize / 2 + Math.max(0, options.leaveStock ?? 0);
  const offset =
    options.side === 'outside'
      ? clearance
      : options.side === 'inside'
        ? -clearance
        : 0;

  const offsetInput =
    offset === 0
      ? input
      : await applyTransform(input, {
          type: 'clipper-inflate',
          offset,
          endType: 'polygon',
          joinType: 'round',
          // The offset transform's fields reach Clipper swapped (see
          // applyTransform): miter limit 2, the settings' decimal places.
          precision: 2,
          miterLimit: decimals(),
          arcTolerance: 0,
        });

  // "Holes only" makes the same cuts as both, but keeps just the parts that
  // come from holes (open paths aren't holes).
  const keep =
    options.mode === 'holes' && closed.length
      ? (await holeSide(closed))(offset)
      : null;

  const polygons = offsetInput
    .flatMap((s) => s.polygons)
    .filter(
      (p) => p.points.length >= 2 && (options.mode !== 'holes' || p.close),
    )
    .flatMap((p) =>
      // Orient first, so pieces of a loop keep its direction.
      keptStretches(
        {
          ...p,
          points: orientPath(
            p.points,
            p.close,
            options.side,
            options.direction,
          ),
        },
        keep,
      ),
    );

  for (const polygon of polygons) {
    let points = polygon.points;
    // When ramping, each pass carries on from where the one before ended,
    // without lifting: round a loop, or back along an open path.
    let resume: Resume | undefined;

    for (let step = 0; step < options.steps; step++) {
      const depth = -(options.startDepth + options.depthPerStep * (step + 1));
      const isLastStep = step === options.steps - 1;

      // Tabs are only meaningful on the final pass of a closed loop: they leave
      // a thin bridge of material so the part stays put when it's cut free.
      const tabFloor =
        isLastStep &&
        options.tabsEnabled &&
        polygon.close &&
        options.tabCount > 0 &&
        options.tabHeight > 0
          ? Math.min(0, depth + options.tabHeight)
          : null;

      // Each pass starts where the previous one left off.
      const from = -(options.startDepth + options.depthPerStep * step);
      const cut = carvePass(
        builder,
        points,
        polygon.points,
        polygon.close,
        from,
        depth,
        tabFloor,
        {
          ...options,
          rampAngle: options.rampAngle ?? null,
          tabOffset: options.tabOffset ?? 0,
        },
        resume,
      );
      if (options.rampAngle) {
        if (polygon.close) {
          points = cut;
        } else {
          // Open paths end at the far end: go back the other way.
          points = [...cut].reverse();
        }
        resume = { point: points[0], down: true };
      }
    }
  }

  return builder;
}

/**
 * The parts of `polygon` where `keep` holds, as open paths that start and end
 * where it stops holding (the whole polygon when it holds everywhere).
 */
function keptStretches(
  polygon: CamPolygon,
  keep: ((p: CamPoint) => boolean) | null,
): CamPolygon[] {
  const { points, close } = polygon;
  const kept = points.map((p) => !keep || keep(p));
  if (kept.every(Boolean)) {
    return [polygon];
  }
  if (!kept.some(Boolean)) {
    return [];
  }
  const n = points.length;
  // Loops start where a kept stretch begins.
  const first = close
    ? kept.findIndex((k, i) => k && !kept[(i - 1 + n) % n])
    : 0;

  // How far the edge from kept `a` towards dropped `b` stays kept.
  const lastKept = (a: CamPoint, b: CamPoint) => {
    const at = (t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * getDistance(a, b) > precision()) {
      const mid = (lo + hi) / 2;
      if (keep!(at(mid))) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return at(lo);
  };

  const order = close
    ? [...Array(n).keys()].map((i) => (first + i) % n)
    : [...Array(n).keys()];
  const stretches: CamPolygon[] = [];
  // A loop's first stretch starts where the edge into it comes back in.
  let current: CamPoint[] | null = close
    ? [lastKept(points[first], points[(first - 1 + n) % n])]
    : null;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const hasNext = close || k < order.length - 1;
    const j = close ? order[(k + 1) % n] : order[k + 1];
    if (kept[i]) {
      current ??= [];
      current.push(points[i]);
      if (hasNext && !kept[j]) {
        current.push(lastKept(points[i], points[j]));
      }
    } else if (hasNext && kept[j] && k < order.length - 1) {
      // (The edge back into the first stretch was handled at the start.)
      current = [lastKept(points[j], points[i])];
    }
    if (current && (!hasNext || !kept[j])) {
      if (current.length > 1) {
        stretches.push({ points: current, close: false });
      }
      current = null;
    }
  }
  return stretches;
}

/**
 * Normalize the travel direction. Climb milling keeps the material on a
 * consistent side of the cutter: clockwise around an outside profile,
 * counter-clockwise around an inside one (and the reverse for conventional).
 * Only closed loops have a meaningful winding.
 */
function orientPath(
  points: CamPoint[],
  close: boolean,
  side: 'outside' | 'inside' | 'on-line',
  direction: 'climb' | 'conventional',
): CamPoint[] {
  if (!close) {
    return points;
  }

  const wantCounterClockwise =
    direction === 'climb' ? side === 'inside' : side !== 'inside';

  const isCounterClockwise = signedArea(points) > 0;
  return isCounterClockwise === wantCounterClockwise
    ? points
    : [...points].reverse();
}

/**
 * One pass along `points` at `depth`. `anchor` is the path as it was first
 * given (`points` may start elsewhere by now): tabs sit at fixed places
 * measured from its first point, so they stay put whatever the pass starts.
 */
function carvePass(
  builder: GCodeBuilder,
  points: CamPoint[],
  anchor: CamPoint[],
  close: boolean,
  from: number,
  depth: number,
  tabFloor: number | null,
  options: {
    tabCount: number;
    tabWidth: number;
    tabOffset: number;
    rampAngle: number | null;
    toolSize: number;
  },
  resume?: Resume,
): CamPoint[] {
  const perimeter = pathLength(close ? [...anchor, anchor[0]] : anchor);
  const layout =
    tabFloor === null
      ? []
      : tabIntervals(
          perimeter,
          options.tabCount,
          options.tabWidth,
          options.tabOffset,
        );
  // The free stretch between two tabs.
  const gap = layout.length
    ? perimeter / layout.length - (layout[0].end - layout[0].start)
    : Infinity;

  if (layout.length) {
    // Start just before a tab when ramping (the ramp gets the gap before
    // it), else plunge in the middle of a gap.
    const start = options.rampAngle
      ? layout[0].start
      : layout[0].start - gap / 2;
    points = startingAt(anchor, start);
    if (resume?.down && options.rampAngle) {
      // Carry on along the cut (at the depth of the pass before, so through
      // material that's gone) to where this pass's ramp starts.
      const needed =
        (from - depth) / Math.tan((options.rampAngle * Math.PI) / 180);
      const rampStart = needed <= gap ? start - needed : start;
      const here = arcTo(anchor, resume.point);
      const ahead = mod(rampStart - here, perimeter);
      for (const p of alongLoop(startingAt(anchor, here), ahead)) {
        builder.carveTo(p.x, p.y);
      }
      resume = { point: startingAt(anchor, rampStart)[0], down: true };
    } else {
      resume = undefined;
    }
  }

  if (!resume?.down) {
    builder.goToSafeHeight();
  }
  points = enterCut(
    builder,
    points,
    close,
    from,
    depth,
    options.rampAngle,
    options.toolSize,
    gap,
    resume,
  );
  // The tabs, measured from where the pass starts.
  const tabs = shiftTabs(
    layout,
    layout.length ? arcTo(anchor, points[0]) : 0,
    perimeter,
  );
  const edges = tabs.flatMap((t) => [t.start, t.end]);

  // Vertices the tool visits in order; a closed loop returns to its start.
  const loop = close ? [...points, points[0]] : points;

  if (tabFloor === null) {
    for (let i = 1; i < loop.length; i++) {
      builder.carveTo(loop[i].x, loop[i].y);
    }
    return points;
  }

  let traveled = 0;
  let currentDepth = depth;

  const setDepth = (atArcLength: number) => {
    const want = inTab(atArcLength + EPS, tabs) ? tabFloor : depth;
    if (want !== currentDepth) {
      builder.plunge(want);
      currentDepth = want;
    }
  };
  // A tab can start right at the start (when ramping).
  setDepth(0);

  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const segLength = getDistance(a, b);
    if (segLength === 0) {
      continue;
    }

    // Split the segment at every tab edge it crosses, lifting to the tab floor
    // inside tabs and dropping back to full depth outside them.
    const crossings = edges
      .filter((s) => s > traveled + EPS && s < traveled + segLength - EPS)
      .sort((x, y) => x - y);

    for (const crossing of crossings) {
      const fraction = (crossing - traveled) / segLength;
      builder.carveTo(
        a.x + (b.x - a.x) * fraction,
        a.y + (b.y - a.y) * fraction,
      );
      setDepth(crossing);
    }

    builder.carveTo(b.x, b.y);
    traveled += segLength;

    if (i < loop.length - 1) {
      setDepth(traveled);
    }
  }
  return points;
}

/**
 * Evenly spaced tabs, measured from the path's first point: centered
 * between multiples of the spacing, then moved along by `offset`.
 */
function tabIntervals(
  perimeter: number,
  count: number,
  width: number,
  offset: number,
): Tab[] {
  if (count <= 0 || width <= 0 || perimeter <= 0) {
    return [];
  }

  const spacing = perimeter / count;
  const half = Math.min(width, spacing) / 2;
  const tabs: Tab[] = [];
  for (let k = 0; k < count; k++) {
    const center = mod((k + 0.5) * spacing + offset, perimeter);
    tabs.push({ start: center - half, end: center + half });
  }
  return tabs.sort((a, b) => a.start - b.start);
}

/**
 * Tabs measured from `start` instead of the path's first point, within
 * [0, perimeter): one that spans the start is split in two.
 */
function shiftTabs(tabs: Tab[], start: number, perimeter: number): Tab[] {
  const shifted: Tab[] = [];
  for (const tab of tabs) {
    const from = mod(tab.start - start, perimeter);
    const to = from + (tab.end - tab.start);
    if (to > perimeter) {
      shifted.push(
        { start: from, end: perimeter },
        { start: 0, end: to - perimeter },
      );
    } else {
      shifted.push({ start: from, end: to });
    }
  }
  return shifted.sort((a, b) => a.start - b.start);
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

function inTab(arcLength: number, tabs: Tab[]): boolean {
  return tabs.some((t) => arcLength >= t.start && arcLength <= t.end);
}

function pathLength(loop: CamPoint[]): number {
  let total = 0;
  for (let i = 1; i < loop.length; i++) {
    total += getDistance(loop[i - 1], loop[i]);
  }
  return total;
}

function signedArea(points: CamPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
