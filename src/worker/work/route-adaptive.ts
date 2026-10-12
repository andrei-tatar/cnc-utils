import { GCodeBuilder } from '../../cam/gcode-builder';
import { curveTolerance, precision } from '../../cam/geometry';
import {
  bulgeOf,
  distanceToPolygons,
  polygonPoints,
  polygonsBounds,
  signedArea,
  windingNumber,
} from '../../cam/arcs';
import {
  booleanOperation,
  clipOpenPaths,
  offsetRegion,
} from '../../cam/kernel';
import { staysInside } from '../../cam/raster';
import { CamPoint, CamPolygon, CamVertex } from '../../cam/types';
import { getDistance } from '../../util';
import { islands } from './clear-surface';

/** One area cleared adaptively: where it starts and the cuts after. */
export type AdaptivePlan = {
  /** The helix down into it: its centre and radius (tool centre). */
  seed: CamPoint;
  radius: number;
  /**
   * The cuts, ring by ring: each ring the parts of the cleared area's new
   * edge (tool centre) not on the last ring's, in the order they're cut.
   * With each ring, the area the tool centre has been over, cleared.
   */
  rings: Array<{ cuts: CamPolygon[]; cleared: CamPolygon[] }>;
};

/** Areas grown by less than this (mm²) are done. */
const DONE = 1e-3;

/**
 * Adaptive clearing of `area` (where the tool centre may go): for each
 * separate part, a helix down at the point furthest from its edges, then
 * the area cleared grows outwards `step` at a time — the tool centre's
 * area grown by `step`, kept inside `area` — and each ring cuts the new
 * edge. Where the edge is growing the bit takes `step` of material; where
 * it runs along the pocket's wall, less; so it's never buried, in corners
 * or narrow parts alike. Parts of a ring's edge that didn't move (along
 * walls already reached) aren't cut again. The edges run the way round
 * that climbs into the material.
 */
export async function adaptivePlans(
  area: CamPolygon[],
  step: number,
  toolRadius: number,
): Promise<AdaptivePlan[]> {
  if (!(step > 0) || !area.length) {
    return [];
  }
  const plans: AdaptivePlan[] = [];
  for (const part of islands(area)) {
    const { point: seed, distance } = furthestFromEdges(part);
    // A helix about a third of the bit across, smaller where it's narrow.
    const radius = Math.max(
      precision(),
      Math.min(distance * 0.9, toolRadius * 0.6),
    );
    let cleared = await booleanOperation(
      [circle(seed, radius)],
      part,
      'intersection',
    );
    if (!cleared.length) continue;
    const rings: AdaptivePlan['rings'] = [];
    const margin = Math.min(step / 4, 2 * precision() + 0.01);
    let area0 = totalArea(cleared);
    for (let k = 0; k < 10_000; k++) {
      const grown = await booleanOperation(
        await offsetRegion(cleared, step),
        part,
        'intersection',
      );
      const area1 = totalArea(grown);
      if (!(area1 - area0 > DONE)) break;
      // Its edge, less what lies on the last ring's (walls already run).
      const edges = grown.map(openLoop);
      const before = await offsetRegion(cleared, margin);
      const cuts = (await clipOpenPaths(edges, before, false)).filter(
        (p) => p.vertices.length > 1,
      );
      rings.push({ cuts, cleared: grown });
      cleared = grown;
      area0 = area1;
    }
    plans.push({ seed, radius, rings });
  }
  return plans;
}

/** How far above the level being cut the bit lifts to go across (mm). */
const LIFT = 1;

/**
 * Cuts the plans at depth `to` (the material at `from` above: cleared
 * there, over all of `area`), from `start`; returns where the bit ends up.
 * Between cuts it stays down when the way stays in what's cleared at this
 * depth; otherwise it lifts just above this level (everything above it is
 * cleared) and comes back down where it's cleared nearest the next cut —
 * over safe height only when the way leaves `area`.
 */
export function cutAdaptive(
  builder: GCodeBuilder,
  plans: AdaptivePlan[],
  area: CamPolygon[],
  from: number,
  to: number,
  rampAngle: number | null,
  start: CamPoint,
): CamPoint {
  const pocket = area.map((p) => polygonPoints(p, curveTolerance()));
  const lifted = from + LIFT;
  let at = start;
  for (const plan of plans) {
    builder.goToSafeHeight();
    at = helix(builder, plan.seed, plan.radius, from, to, rampAngle);
    let cleared: CamPolygon[] = [circle(plan.seed, plan.radius)];
    for (const ring of plan.rings) {
      const inside = cleared.map((p) => polygonPoints(p, curveTolerance()));
      const left = [...ring.cuts];
      while (left.length) {
        // The nearest next.
        let best = 0;
        let bestDistance = Infinity;
        left.forEach((cut, i) => {
          const d = getDistance(at, cut.vertices[0]);
          if (d < bestDistance) {
            best = i;
            bestDistance = d;
          }
        });
        const [cut] = left.splice(best, 1);
        const first = cut.vertices[0];
        if (!builder.isAtSafetyHeight && staysInside(inside, at, first)) {
          builder.carveTo(first.x, first.y, to);
        } else {
          // Down where it's cleared, nearest the cut, then across to it.
          const down = nearestOn(cleared, first);
          if (!builder.isAtSafetyHeight && staysInside(pocket, at, down)) {
            builder.rapidZ(lifted);
            builder.travelTo(down.x, down.y);
          } else {
            builder.goToSafeHeight();
            builder.travelTo(down.x, down.y);
            builder.rapidZ(lifted);
          }
          builder.plunge(to);
          builder.carveTo(first.x, first.y, to);
        }
        at = carvePath(builder, cut.vertices, to);
      }
      cleared = ring.cleared;
    }
  }
  return at;
}

/** Down a helix round `center` from `from` to `to`, then once round flat. */
function helix(
  builder: GCodeBuilder,
  center: CamPoint,
  radius: number,
  from: number,
  to: number,
  rampAngle: number | null,
): CamPoint {
  const startPoint = { x: center.x + radius, y: center.y };
  const opposite = { x: center.x - radius, y: center.y };
  builder.travelTo(startPoint.x, startPoint.y);
  builder.plunge(from);
  // Counter-clockwise (bulge +1 per half): climbing out into the material.
  const angle = rampAngle && rampAngle > 0 ? rampAngle : 3;
  const perTurn = 2 * Math.PI * radius * Math.tan((angle * Math.PI) / 180);
  const turns = Math.max(
    1,
    Math.ceil((from - to) / Math.max(perTurn, 1e-6) - 1e-9),
  );
  for (let t = 0; t < turns; t++) {
    const half = from - ((from - to) * (t + 0.5)) / turns;
    const whole = from - ((from - to) * (t + 1)) / turns;
    builder.arcTo(opposite.x, opposite.y, 1, half);
    builder.arcTo(startPoint.x, startPoint.y, 1, whole);
  }
  builder.arcTo(opposite.x, opposite.y, 1, to);
  builder.arcTo(startPoint.x, startPoint.y, 1, to);
  return startPoint;
}

/** Along an open path at `z`, arcs as arcs; returns where it ends. */
function carvePath(
  builder: GCodeBuilder,
  vertices: CamVertex[],
  z: number,
): CamPoint {
  for (let i = 1; i < vertices.length; i++) {
    builder.arcTo(vertices[i].x, vertices[i].y, bulgeOf(vertices[i - 1]), z);
  }
  return vertices[vertices.length - 1];
}

/** A closed loop as an open path round it, back to its start. */
function openLoop(loop: CamPolygon): CamPolygon {
  const [first] = loop.vertices;
  return {
    vertices: [...loop.vertices, { x: first.x, y: first.y }],
    close: false,
  };
}

/** A circle as a loop of two half arcs, counter-clockwise. */
function circle(center: CamPoint, radius: number): CamPolygon {
  return {
    vertices: [
      { x: center.x + radius, y: center.y, bulge: 1 },
      { x: center.x - radius, y: center.y, bulge: 1 },
    ],
    close: true,
  };
}

function totalArea(region: CamPolygon[]): number {
  return region.reduce((sum, p) => sum + signedArea(p), 0);
}

/**
 * The point of a part (an outline and its holes) furthest from its edges,
 * and how far: searched on a grid, then finer round the best.
 */
function furthestFromEdges(part: CamPolygon[]): {
  point: CamPoint;
  distance: number;
} {
  const box = polygonsBounds(part);
  let best = {
    point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    distance: -Infinity,
  };
  let span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  let center = best.point;
  for (let pass = 0; pass < 4; pass++) {
    const n = 24;
    const cell = span / n;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = {
          x: center.x - span / 2 + i * cell,
          y: center.y - span / 2 + j * cell,
        };
        if (!windingNumber(p, part)) continue;
        const d = distanceToPolygons(p, part);
        if (d > best.distance) best = { point: p, distance: d };
      }
    }
    center = best.point;
    span = (span / n) * 4;
  }
  return best.distance > 0 ? best : { point: part[0].vertices[0], distance: 0 };
}

/** The point of `region`'s edges nearest `p` (arcs read as their points). */
function nearestOn(region: CamPolygon[], p: CamPoint): CamPoint {
  let best = p;
  let distance = Infinity;
  for (const polygon of region) {
    const points = polygonPoints(polygon, curveTolerance());
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t =
        l2 > 0
          ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
          : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = getDistance(p, q);
      if (d < distance) {
        best = q;
        distance = d;
      }
    }
  }
  return best;
}
