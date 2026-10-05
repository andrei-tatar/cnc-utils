import { CamPoint, CamPolygon, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
import {
  PRECISION,
  ShapePart,
  filledOutlines,
  holeSide,
} from '../../cam/vcarve-geometry';
import { enterCut, rampWarning } from '../../cam/ramp';
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
    startDepth: number;
    depthPerStep: number;
    steps: number;
    tabsEnabled: boolean;
    tabCount: number;
    tabWidth: number;
    tabHeight: number;
    /** Which part of the shape to profile. */
    mode?: ShapePart;
    /** Ramp down into each pass at this angle (degrees) instead of plunging. */
    rampAngle?: number | null;
  },
): Promise<GCodeBuilder> {
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
    const filled = (await filledOutlines(closed)).map(
      (points): CamPolygon => ({ points, close: true }),
    );
    input = [{ sourceShapeId, polygons: [...filled, ...open] }];
  }

  // Offset the outline by half the tool diameter so the cutting edge lands on
  // the shape boundary. 'on-line' rides the path itself (no compensation).
  const offset =
    options.side === 'outside'
      ? options.toolSize / 2
      : options.side === 'inside'
        ? -options.toolSize / 2
        : 0;

  const offsetInput =
    offset === 0
      ? input
      : await applyTransform(input, {
          type: 'clipper-inflate',
          offset,
          endType: 'polygon',
          joinType: 'round',
          miterLimit: 2,
          precision: 0.01,
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

  // How much path each ramp had (see enterCut).
  const reaches: Array<number | null> = [];
  for (const polygon of polygons) {
    const points = polygon.points;

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
      reaches.push(
        carvePass(builder, points, polygon.close, from, depth, tabFloor, {
          ...options,
          rampAngle: options.rampAngle ?? null,
        }),
      );
    }
  }

  const warning = rampWarning(reaches, options.toolSize);
  if (warning) {
    builder.warn(warning);
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
    while ((hi - lo) * getDistance(a, b) > PRECISION) {
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

function carvePass(
  builder: GCodeBuilder,
  points: CamPoint[],
  close: boolean,
  from: number,
  depth: number,
  tabFloor: number | null,
  options: { tabCount: number; tabWidth: number; rampAngle: number | null },
): number | null {
  // Vertices the tool visits in order; a closed loop returns to its start.
  const loop = close ? [...points, points[0]] : points;
  const perimeter = pathLength(loop);
  // When ramping, tabs start at the loop's start, so the ramp gets the whole
  // gap before it (ramps stay clear of tabs); otherwise they're centered
  // between starts, so plunges are clear of them.
  const tabs =
    tabFloor === null
      ? []
      : tabIntervals(
          perimeter,
          options.tabCount,
          options.tabWidth,
          options.rampAngle ? 'at-start' : 'centered',
        );
  const edges = tabs.flatMap((t) => [t.start, t.end]);

  builder.goToSafeHeight();
  // A ramp stays on the stretch after the last tab, which ends the loop.
  const reach = enterCut(
    builder,
    points,
    close,
    from,
    depth,
    options.rampAngle,
    tabs.length ? perimeter - tabs[tabs.length - 1].end : Infinity,
  );

  if (tabFloor === null) {
    for (let i = 1; i < loop.length; i++) {
      builder.carveTo(loop[i].x, loop[i].y);
    }
    return reach;
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
  return reach;
}

/**
 * Evenly spaced tabs: `centered` between starts (the start point stays
 * clear), or the first one `at-start` (all the room is just before it).
 */
function tabIntervals(
  perimeter: number,
  count: number,
  width: number,
  placement: 'centered' | 'at-start',
): Tab[] {
  if (count <= 0 || width <= 0 || perimeter <= 0) {
    return [];
  }

  const spacing = perimeter / count;
  const half = Math.min(width, spacing) / 2;
  const tabs: Tab[] = [];
  for (let k = 0; k < count; k++) {
    const center =
      placement === 'centered' ? (k + 0.5) * spacing : k * spacing + half;
    tabs.push({ start: center - half, end: center + half });
  }
  return tabs;
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
