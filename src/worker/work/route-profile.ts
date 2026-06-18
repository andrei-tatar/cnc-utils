import { CamPoint, CamShape } from '../../cam/types';
import { GCodeBuilder } from '../../cam/gcode-builder';
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
  },
): Promise<GCodeBuilder> {
  const builder = new GCodeBuilder();
  builder.sourceShapeId(input?.[0]?.sourceShapeId);

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

  const polygons = offsetInput.flatMap((s) => s.polygons);

  for (const polygon of polygons) {
    if (polygon.points.length < 2) {
      continue;
    }

    const points = orientPath(
      polygon.points,
      polygon.close,
      options.side,
      options.direction,
    );

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

      carvePass(builder, points, polygon.close, depth, tabFloor, options);
    }
  }

  return builder;
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
  depth: number,
  tabFloor: number | null,
  options: { tabCount: number; tabWidth: number },
) {
  builder.goToSafeHeight();
  builder.travelTo(points[0].x, points[0].y);
  builder.plunge(depth);

  // Vertices the tool visits in order; a closed loop returns to its start.
  const loop = close ? [...points, points[0]] : points;

  if (tabFloor === null) {
    for (let i = 1; i < loop.length; i++) {
      builder.carveTo(loop[i].x, loop[i].y);
    }
    return;
  }

  const perimeter = pathLength(loop);
  const tabs = tabIntervals(perimeter, options.tabCount, options.tabWidth);
  const edges = tabs.flatMap((t) => [t.start, t.end]);

  let traveled = 0;
  let currentDepth = depth;

  const setDepth = (atArcLength: number) => {
    const want = inTab(atArcLength + EPS, tabs) ? tabFloor : depth;
    if (want !== currentDepth) {
      builder.plunge(want);
      currentDepth = want;
    }
  };

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
}

/** Evenly spaced tabs, centered between seams so the start point stays clear. */
function tabIntervals(perimeter: number, count: number, width: number): Tab[] {
  if (count <= 0 || width <= 0 || perimeter <= 0) {
    return [];
  }

  const spacing = perimeter / count;
  const half = Math.min(width, spacing) / 2;
  const tabs: Tab[] = [];
  for (let k = 0; k < count; k++) {
    const center = (k + 0.5) * spacing;
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
