import { containingContours } from './polygon-nesting';
import { CamPoint } from './types';
import { getDistance } from '../util';

/** Something to cut, as far as the travel between cuts goes. */
export type TravelStop = {
  /** Where the cut can start (a loop: any of its points). */
  starts: CamPoint[];
  /** Where it ends when started at `starts[i]` (default: where it started). */
  end?: (start: number) => CamPoint;
  /** Stops (indices) that must be cut before this one. */
  after?: number[];
};

/** A stop in the order to cut it, and which of its starts to use. */
export type TravelLeg = { index: number; start: number };

/** Above this many stops, the order isn't improved past nearest-first. */
const MAX_IMPROVED = 2000;
/** Rounds of improving the order, then picking the starts again. */
const ROUNDS = 3;

/**
 * An order for the stops that keeps the travel between them (from `from`)
 * short: nearest first, then improved by reversing stretches of the order
 * (2-opt) and moving short runs of stops elsewhere in it (Or-opt) while
 * that shortens it, keeping every stop after those it must follow.
 */
export function travelOrder(stops: TravelStop[], from: CamPoint): TravelLeg[] {
  let legs = nearestFirst(stops, from);
  if (stops.length < 2 || stops.length > MAX_IMPROVED) {
    return legs;
  }
  let length = travelLength(stops, legs, from);
  for (let round = 0; round < ROUNDS; round++) {
    const reordered = orOpt(stops, twoOpt(stops, legs, from), from);
    let improved = false;
    // Starts picked again for the new order: better more often than not.
    for (const candidate of [
      reordered,
      nearestStarts(stops, reordered, from),
    ]) {
      const candidateLength = travelLength(stops, candidate, from);
      if (candidateLength < length - 1e-9) {
        legs = candidate;
        length = candidateLength;
        improved = true;
      }
    }
    if (!improved) {
      break;
    }
  }
  return legs;
}

/** The points in the order that keeps the travel between them short. */
export function orderPoints<T extends CamPoint>(
  points: T[],
  from: CamPoint,
): T[] {
  return travelOrder(
    points.map((p) => ({ starts: [p] })),
    from,
  ).map(({ index }) => points[index]);
}

/** How far the tool travels between the stops, cut in this order. */
export function travelLength(
  stops: TravelStop[],
  legs: TravelLeg[],
  from: CamPoint,
): number {
  let at = from;
  let total = 0;
  for (const { index, start } of legs) {
    total += getDistance(at, stops[index].starts[start]);
    at = endOf(stops[index], start);
  }
  return total;
}

/**
 * For each path, the paths that lie inside it (closed paths only have an
 * inside): cutting those first keeps a part held until its outline frees it.
 */
export function insideFirst(
  paths: { points: CamPoint[]; close: boolean }[],
): number[][] {
  const after: number[][] = paths.map(() => []);
  containingContours(paths.map((p) => p.points)).forEach((outer, i) => {
    for (const j of outer) {
      if (paths[j].close) {
        after[j].push(i);
      }
    }
  });
  return after;
}

function endOf(stop: TravelStop, start: number): CamPoint {
  return stop.end ? stop.end(start) : stop.starts[start];
}

/** The start of `stop` nearest `p`. */
function nearestStart(stop: TravelStop, p: CamPoint) {
  let best = 0;
  let bestDistance = Infinity;
  stop.starts.forEach((q, i) => {
    const d = getDistance(p, q);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return { start: best, distance: bestDistance };
}

/** Greedily, the nearest stop that may be cut next. */
function nearestFirst(stops: TravelStop[], from: CamPoint): TravelLeg[] {
  const done = stops.map(() => false);
  const legs: TravelLeg[] = [];
  let at = from;
  while (legs.length < stops.length) {
    const ready = (i: number) =>
      !done[i] && (stops[i].after ?? []).every((j) => done[j] || j === i);
    let candidates = stops.map((_, i) => i).filter(ready);
    if (!candidates.length) {
      // Stops that must follow each other: the order can't be kept.
      candidates = stops.map((_, i) => i).filter((i) => !done[i]);
    }
    let best: TravelLeg & { distance: number } = {
      index: -1,
      start: 0,
      distance: Infinity,
    };
    for (const index of candidates) {
      const { start, distance } = nearestStart(stops[index], at);
      if (distance < best.distance || best.index < 0) {
        best = { index, start, distance };
      }
    }
    done[best.index] = true;
    legs.push({ index: best.index, start: best.start });
    at = endOf(stops[best.index], best.start);
  }
  return legs;
}

/** Each stop's start picked again: the nearest to where the one before ended. */
function nearestStarts(
  stops: TravelStop[],
  legs: TravelLeg[],
  from: CamPoint,
): TravelLeg[] {
  let at = from;
  return legs.map(({ index }) => {
    const { start } = nearestStart(stops[index], at);
    at = endOf(stops[index], start);
    return { index, start };
  });
}

/**
 * The legs' starts and ends as points, and where each stop is in the order:
 * kept up to date (`refresh`) as moves change the order.
 */
function legPoints(stops: TravelStop[], legs: TravelLeg[]) {
  const n = legs.length;
  const entries: CamPoint[] = new Array(n);
  const exits: CamPoint[] = new Array(n);
  const position = new Int32Array(stops.length);
  const refresh = () => {
    legs.forEach(({ index, start }, k) => {
      entries[k] = stops[index].starts[start];
      exits[k] = endOf(stops[index], start);
      position[index] = k;
    });
  };
  refresh();
  // Whether the stop at k must follow one at first..last.
  const mustFollow = (k: number, first: number, last: number) =>
    (stops[legs[k].index].after ?? []).some(
      (j) => position[j] >= first && position[j] <= last,
    );
  return { entries, exits, refresh, mustFollow, position };
}

/**
 * Reverses stretches of the order (each stop still cut the same way) while
 * that shortens the travel, keeping the starts.
 */
function twoOpt(
  stops: TravelStop[],
  legs: TravelLeg[],
  from: CamPoint,
): TravelLeg[] {
  legs = [...legs];
  const n = legs.length;
  const { entries, exits, refresh, mustFollow } = legPoints(stops, legs);
  const exit = (k: number) => (k < 0 ? from : exits[k]);

  // Forward: k's end to k+1's start. Backward: k+1's end to k's start (what
  // the stretch costs reversed). Prefix sums of both.
  const forward = new Float64Array(n);
  const backward = new Float64Array(n);
  const sums = () => {
    for (let k = 0; k < n - 1; k++) {
      forward[k + 1] = forward[k] + getDistance(exits[k], entries[k + 1]);
      backward[k + 1] = backward[k] + getDistance(exits[k + 1], entries[k]);
    }
  };
  sums();

  const hasOrder = stops.some((s) => s.after?.length);
  // No stop in i..j may have to follow another one in i..j.
  const reversible = (i: number, j: number) => {
    for (let k = i; hasOrder && k <= j; k++) {
      if (mustFollow(k, i, j)) {
        return false;
      }
    }
    return true;
  };

  for (let sweep = 0, improved = true; improved && sweep < 50; sweep++) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const current =
          getDistance(exit(i - 1), entries[i]) +
          (forward[j] - forward[i]) +
          (j < n - 1 ? getDistance(exits[j], entries[j + 1]) : 0);
        const swapped =
          getDistance(exit(i - 1), entries[j]) +
          (backward[j] - backward[i]) +
          (j < n - 1 ? getDistance(exits[i], entries[j + 1]) : 0);
        if (swapped < current - 1e-9 && reversible(i, j)) {
          const reversed = legs.slice(i, j + 1).reverse();
          legs.splice(i, reversed.length, ...reversed);
          refresh();
          sums();
          improved = true;
        }
      }
    }
  }
  return legs;
}

/** Moving at most this many stops at a time (Or-opt). */
const MAX_MOVED = 3;
/** Or-opt moves stops only next to this many of their nearest stops. */
const NEIGHBOURS = 10;

/** For each stop, the stops nearest it (by the middle of their starts). */
function nearestStops(stops: TravelStop[]): number[][] {
  const middles = stops.map(({ starts }) => ({
    x: starts.reduce((sum, p) => sum + p.x, 0) / starts.length,
    y: starts.reduce((sum, p) => sum + p.y, 0) / starts.length,
  }));
  return middles.map((m, i) =>
    middles
      .map((other, j) => ({ j, d: getDistance(m, other) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOURS)
      .map(({ j }) => j),
  );
}

/**
 * Moves runs of up to `MAX_MOVED` stops (each still cut the same way) to
 * wherever next to their nearest stops (or first) shortens the travel
 * most, while one does.
 */
function orOpt(
  stops: TravelStop[],
  legs: TravelLeg[],
  from: CamPoint,
): TravelLeg[] {
  legs = [...legs];
  const n = legs.length;
  const { entries, exits, refresh, mustFollow, position } = legPoints(
    stops,
    legs,
  );
  const neighbours = nearestStops(stops);
  // The travel from k's end (or the start) to l's start (none after the
  // last).
  const gap = (k: number, l: number) =>
    l < n ? getDistance(k < 0 ? from : exits[k], entries[l]) : 0;

  const hasOrder = stops.some((s) => s.after?.length);
  // Moving i..j to after p: the stops it passes must not have to come
  // before (moving back) or after (moving on) any of them.
  const movable = (i: number, j: number, p: number) => {
    if (!hasOrder) {
      return true;
    }
    for (let k = p < i ? i : j + 1; k <= (p < i ? j : p); k++) {
      if (p < i ? mustFollow(k, p + 1, i - 1) : mustFollow(k, i, j)) {
        return false;
      }
    }
    return true;
  };

  for (let sweep = 0, improved = true; improved && sweep < 50; sweep++) {
    improved = false;
    for (let length = 1; length <= MAX_MOVED; length++) {
      for (let i = 0; i + length <= n; i++) {
        const j = i + length - 1;
        const saved = gap(i - 1, i) + gap(j, j + 1) - gap(i - 1, j + 1);
        // Where moving i..j saves the most: first, after a stop near its
        // first, or before one near its last.
        const places = [
          -1,
          ...neighbours[legs[i].index].map((m) => position[m]),
          ...neighbours[legs[j].index].map((m) => position[m] - 1),
        ];
        let best = { p: 0, saving: 1e-9 };
        for (const p of places) {
          if (p >= i - 1 && p <= j) {
            continue;
          }
          const saving = saved - (gap(p, i) + gap(j, p + 1) - gap(p, p + 1));
          if (saving > best.saving && movable(i, j, p)) {
            best = { p, saving };
          }
        }
        if (best.saving > 1e-9) {
          const { p } = best;
          const moved = legs.splice(i, length);
          legs.splice(p < i ? p + 1 : p + 1 - length, 0, ...moved);
          refresh();
          improved = true;
        }
      }
    }
  }
  return legs;
}
