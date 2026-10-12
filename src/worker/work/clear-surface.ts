import { GCodeBuilder } from '../../cam/gcode-builder';
import { curveTolerance } from '../../cam/geometry';
import {
  bulgeOf,
  distanceToPolygons,
  fromPoints,
  polygonPoints,
  signedArea,
  windingNumber,
} from '../../cam/arcs';
import { staysInside } from '../../cam/raster';
import { enterCut } from '../../cam/ramp';
import { getDistance } from '../../util';
import {
  clearableLoops,
  clearingLevels,
} from '../../cam/image-engrave-clearing';
import { Heightmap } from '../../cam/simulate';
import { simplifyPoints } from '../../cam/simplify';
import { CamPoint, CamPolygon, CamVertex } from '../../cam/types';
import { inflate, regionOf } from './regions';

/** How an end mill clears down to a surface. */
export type SurfaceClearingOptions = {
  toolSize: number;
  /** Share of its diameter between rings. */
  toolEngagement: number;
  depthPerStep: number;
  rampAngle?: number | null;
  /** Pocket the separate areas in the order that keeps travel short. */
  optimizeTravel?: boolean;
};

/**
 * Clears with an end mill down to `total` (mm below the top) over
 * `surface`, never closer than `margin` to it: level by level, outlines
 * where the surface is `margin` or more below the level and pockets them
 * (rings inwards, like a pocket's offset strategy), an area and then the
 * deeper ones inside it before the next nearest.
 */
export async function clearOverSurface(
  builder: GCodeBuilder,
  surface: Heightmap,
  margin: number,
  total: number,
  options: SurfaceClearingOptions,
): Promise<void> {
  // The outlines are read off cell centres and then simplified: keep that
  // far inside them.
  const tolerance = Math.max(curveTolerance(), surface.cell / 4);
  const inset = surface.cell * Math.SQRT1_2 + tolerance;

  // Each level's areas, an island (an outline and its holes) each, under
  // the island of the level above it lies in: deeper levels only ever lie
  // inside shallower ones.
  type Island = { polygons: CamPolygon[]; depth: number; inside: Island[] };
  const roots: Island[] = [];
  let parents: Island[] = [];
  for (const depth of clearingLevels(total, options.depthPerStep)) {
    const loops = clearableLoops(surface, -depth, margin)
      .map((loop) => simplifyPoints(loop, tolerance, true))
      .filter((loop) => loop.length > 2);
    const region = await inflate(
      await regionOf(loops.map((loop) => fromPoints(loop, true))),
      -inset,
    );
    const level = islands(region).map((polygons) => ({
      polygons,
      depth,
      inside: [] as Island[],
    }));
    for (const island of level) {
      const point = island.polygons[0].vertices[0];
      // In the island above it (the nearest, should rounding put it just
      // outside).
      const parent =
        parents.find((p) => windingNumber(point, p.polygons)) ??
        parents[nearestIsland(parents, point)];
      (parent?.inside ?? roots).push(island);
    }
    parents = level;
  }

  // Depth first: an island, then what's deeper inside it, then the next
  // nearest island.
  const radius = options.toolSize / 2;
  const step = options.toolSize * Math.min(1, options.toolEngagement);
  let at: CamPoint = { x: 0, y: 0 };
  // The depth the bit is down at, if it's down.
  let down: number | null = null;
  const route = async (list: Island[], above: number) => {
    const remaining = [...list];
    while (remaining.length) {
      const index =
        options.optimizeTravel === false ? 0 : nearestIsland(remaining, at);
      const [island] = remaining.splice(index, 1);
      // One step down from the island above; more, should one be missing.
      const steps = Math.max(
        1,
        Math.ceil((island.depth - above) / options.depthPerStep - 1e-9),
      );
      for (let k = 1; k <= steps; k++) {
        const from = above + ((island.depth - above) * (k - 1)) / steps;
        const to = above + ((island.depth - above) * k) / steps;
        await clearIsland(island.polygons, -from, -to);
      }
      await route(island.inside, island.depth);
    }
  };

  /**
   * Clears an island at Z `to` (its material at `from`) with rings
   * `step` apart inside the area the bit's centre may cover: from the
   * innermost out, staying down from one ring to the next; where the
   * rings split, one piece's rings before the next nearest piece's.
   */
  const clearIsland = async (
    polygons: CamPolygon[],
    from: number,
    to: number,
  ) => {
    const area = await inflate(polygons, -radius);
    if (!area.length) return;
    const inside = area.map((p) => polygonPoints(p, curveTolerance()));
    // The rings, each piece under the piece of the ring outside it.
    type Ring = { loops: CamPolygon[]; inner: Ring[] };
    const roots: Ring[] = islands(area).map((loops) => ({ loops, inner: [] }));
    let outer = roots;
    for (let k = 1; step > 0; k++) {
      const ring = islands(await inflate(area, -step * k)).map((loops) => ({
        loops,
        inner: [] as Ring[],
      }));
      if (!ring.length) break;
      for (const piece of ring) {
        const point = piece.loops[0].vertices[0];
        const parent =
          outer.find((o) => windingNumber(point, o.loops)) ??
          outer[
            nearestIsland(
              outer.map((o) => ({ polygons: o.loops })),
              point,
            )
          ];
        parent.inner.push(piece);
      }
      outer = ring;
    }

    const cut = (rings: Ring[]) => {
      const remaining = [...rings];
      while (remaining.length) {
        const index =
          options.optimizeTravel === false
            ? 0
            : nearestIsland(
                remaining.map((r) => ({ polygons: r.loops })),
                at,
              );
        const [ring] = remaining.splice(index, 1);
        cut(ring.inner);
        const loops = [...ring.loops];
        while (loops.length) {
          const i =
            options.optimizeTravel === false
              ? 0
              : nearestIsland(
                  loops.map((l) => ({ polygons: [l] })),
                  at,
                );
          cutLoop(loops.splice(i, 1)[0]);
        }
      }
    };

    /** One ring, from its point nearest the bit. */
    const cutLoop = (loop: CamPolygon) => {
      let points = startingNear(loop.vertices, at);
      const start = points[0];
      if (
        down === to &&
        getDistance(at, start) <= 2 * options.toolSize &&
        staysInside(inside, at, start)
      ) {
        // Across to it at this depth, inside what the bit may cover.
        builder.carveTo(start.x, start.y, to);
      } else {
        builder.goToSafeHeight();
        down = null;
        points = enterCut(
          builder,
          points,
          true,
          from,
          to,
          options.rampAngle ?? null,
          options.toolSize,
        );
      }
      for (let i = 1; i < points.length; i++) {
        builder.arcTo(points[i].x, points[i].y, bulgeOf(points[i - 1]), to);
      }
      builder.arcTo(
        points[0].x,
        points[0].y,
        bulgeOf(points[points.length - 1]),
        to,
      );
      at = points[0];
      down = to;
    };

    cut(roots);
  };

  await route(roots, 0);
}

/** The loop's vertices, starting at the one nearest `p`. */
function startingNear(vertices: CamVertex[], p: CamPoint): CamVertex[] {
  let best = 0;
  vertices.forEach((v, i) => {
    if (getDistance(v, p) < getDistance(vertices[best], p)) best = i;
  });
  return [...vertices.slice(best), ...vertices.slice(0, best)];
}

/** A region's islands: each outline with the holes in it. */
function islands(region: CamPolygon[]): CamPolygon[][] {
  const outlines = region.filter((p) => signedArea(p) > 0);
  const groups = outlines.map((outline) => [outline]);
  for (const hole of region.filter((p) => signedArea(p) <= 0)) {
    const point = hole.vertices[0];
    // The smallest outline round it.
    let best = -1;
    outlines.forEach((outline, i) => {
      if (
        windingNumber(point, [outline]) &&
        (best < 0 || signedArea(outline) < signedArea(outlines[best]))
      ) {
        best = i;
      }
    });
    if (best >= 0) groups[best].push(hole);
  }
  return groups;
}

/** The island whose outline comes nearest `at`. */
function nearestIsland(list: Array<{ polygons: CamPolygon[] }>, at: CamPoint) {
  let best = 0;
  let distance = Infinity;
  list.forEach(({ polygons }, i) => {
    const d = distanceToPolygons(at, [polygons[0]]);
    if (d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}
