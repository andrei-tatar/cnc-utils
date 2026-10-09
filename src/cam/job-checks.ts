import { distanceToPolygons, hasArcs, polygonPoints } from './arcs';
import { findCorners } from './corners';
import { insidePolygons } from './polygon-nesting';
import { StockOptions } from './stock';
import { CamPath, CamPoint, CamPolygon, CamShape } from './types';

/** Something about the job to look at before cutting. */
export type JobWarning = {
  /** `warning`: likely to spoil the job or the machine; `note`: worth a look. */
  level: 'warning' | 'note';
  text: string;
  /** The operation it's about, if any (to highlight it). */
  operationId?: string;
};

/** An operation, as the checks see it. */
export type CheckedOperation = {
  id: string;
  name: string;
  type: string;
  bitType: string;
  toolDiameter: number;
  /** How long the bit's cutting edge is (mm); 0 or less: not known. */
  fluteLength: number;
  /** How deep each step goes, for operations that cut in steps. */
  depthPerStep: number | null;
  /** Share of the bit's diameter each pass takes (pockets, clearing). */
  engagement: number | null;
  /**
   * Which corners of its shape a round bit leaves rounded: a pocket's or an
   * inside profile's outside corners (`convex`), an outside profile's inside
   * ones (`concave`). Null when it doesn't matter.
   */
  roundsCorners: 'convex' | 'concave' | null;
  /** Its shape, after the shape's transforms. */
  shape: CamShape[];
  /** The shape has dogbones (or rounded corners) made for the bit. */
  cornersHandled: boolean;
  /** Cuts parts out (an outside profile): they need holding. */
  cutsOut: boolean;
  /** Leaves an onion skin, holding parts until the last pass. */
  onionSkin: boolean;
};

/** A clamp or other zone the bit must keep away from. */
export type KeepOut = { name: string; polygons: CamPolygon[] };

export type JobCheckInput = {
  stock: StockOptions;
  operations: CheckedOperation[];
  /** The toolpaths, in design coordinates. */
  paths: CamPath[];
  keepOuts: KeepOut[];
  /**
   * The outlines of the parts cut out (by outside profiles): rounded corners
   * only matter on them. Empty: everything counts.
   */
  parts?: CamPolygon[];
};

/**
 * How far into the spoilboard a cut may go before it's flagged (mm): cutting
 * parts free usually takes a few tenths more than the stock is thick.
 */
const SPOILBOARD_TOLERANCE = 0.5;
/** Corners sharper than this (radians between the edges) are corners. */
const SHARP = (150 * Math.PI) / 180;
/** Engagement above this is heavy for a pocket (share of the diameter). */
const HEAVY_ENGAGEMENT = 0.6;

/** Things to check before cutting, the warnings first. */
export function checkJob(input: JobCheckInput): JobWarning[] {
  const warnings: JobWarning[] = [];
  const byOperation = new Map<string, CamPath[]>();
  for (const path of input.paths) {
    if (path.type !== 'carve' || !path.sourceOperationId) continue;
    const list = byOperation.get(path.sourceOperationId) ?? [];
    list.push(path);
    byOperation.set(path.sourceOperationId, list);
  }

  for (const op of input.operations) {
    const paths = byOperation.get(op.id) ?? [];
    if (!paths.length) continue;
    const deepest = Math.min(
      ...paths.map((p) => Math.min(...p.points.map((q) => q.z))),
    );
    const depth = -deepest;
    const add = (level: JobWarning['level'], text: string) =>
      warnings.push({ level, text: `${op.name}: ${text}`, operationId: op.id });

    // On a rotary axis, there's no spoilboard under the stock.
    if (input.stock.enabled && input.stock.mount !== 'rotary') {
      const below = depth - input.stock.thickness;
      if (below > SPOILBOARD_TOLERANCE + 1e-6) {
        add('warning', `cuts ${mm(below)} into the spoilboard`);
      }
    }

    if (op.fluteLength > 0 && depth > op.fluteLength + 1e-6) {
      add(
        'warning',
        `goes ${mm(depth)} deep, past the bit’s ${mm(op.fluteLength)} flutes`,
      );
    }

    if (
      op.depthPerStep !== null &&
      op.toolDiameter > 0 &&
      op.depthPerStep > op.toolDiameter + 1e-6 &&
      op.bitType !== 'v-bit'
    ) {
      add(
        'note',
        `steps of ${mm(op.depthPerStep)} are deeper than the Ø${round(op.toolDiameter)} bit is wide (about half its diameter suits hardwood)`,
      );
    }

    if (op.engagement !== null && op.engagement > HEAVY_ENGAGEMENT) {
      add(
        'note',
        `engagement ${Math.round(op.engagement * 100)}% is heavy; 40–50% is usual`,
      );
    }

    if (op.roundsCorners && !op.cornersHandled && op.toolDiameter > 0) {
      const count = sharpCorners(op.shape, op.roundsCorners, input.parts);
      if (count) {
        add(
          'note',
          `${count} ${op.roundsCorners === 'convex' ? 'corner' : 'inside corner'}${
            count === 1 ? '' : 's'
          } come${count === 1 ? 's' : ''} out rounded (r${round(op.toolDiameter / 2)}): add dogbones if something square must fit`,
        );
      }
    }

    if (
      op.cutsOut &&
      input.stock.enabled &&
      depth >= input.stock.thickness - 1e-6 &&
      !op.onionSkin &&
      !op.shape.some((s) => s.tabs?.length)
    ) {
      add(
        'note',
        'cuts parts free with no tabs or onion skin: hold them down (screws, vacuum) or they may move',
      );
    }

    const radius = op.toolDiameter / 2;
    for (const keepOut of input.keepOuts) {
      if (
        paths.some((path) => pathHits(path.points, keepOut.polygons, radius))
      ) {
        add('warning', `comes within reach of the clamp “${keepOut.name}”`);
      }
    }
  }

  return warnings.sort((a, b) =>
    a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1,
  );
}

/**
 * How many corners of `shape` are sharp, convex or concave (only those
 * within `parts`, when given: a through dado's corners past the part's edge
 * don't matter).
 */
export function sharpCorners(
  shape: CamShape[],
  kind: 'convex' | 'concave',
  parts: CamPolygon[] = [],
): number {
  const polygons = shape
    .flatMap((s) => s.polygons)
    .filter((p) => p.close && (p.vertices.length > 2 || hasArcs(p)));
  return findCorners(polygons)
    .flatMap((p) => p.corners)
    .filter(
      (c) =>
        c.angle < SHARP &&
        c.convex === (kind === 'convex') &&
        (!parts.length ||
          parts.some(
            // On a part's outline counts (its own corners are).
            (part) =>
              insidePolygons(c.point, [part]) ||
              distanceToPolygons(c.point, [part]) < 1e-6,
          )),
    ).length;
}

/**
 * Whether a bit of `radius` moving along `points` touches any of the
 * closed `polygons` (comes within its radius of an edge, or is inside;
 * arcs are taken as lines within 0.01 mm).
 */
export function pathHits(
  points: CamPoint[],
  polygons: CamPolygon[],
  radius: number,
): boolean {
  const closed = polygons
    .filter((p) => p.close)
    .map((p) => polygonPoints(p))
    .filter((ps) => ps.length > 2);
  if (!closed.length || !points.length) return false;
  const box = boundsOf(closed.flat(), radius);
  const pathBox = boundsOf(points, 0);
  if (
    pathBox.maxX < box.minX ||
    pathBox.minX > box.maxX ||
    pathBox.maxY < box.minY ||
    pathBox.minY > box.maxY
  ) {
    return false;
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1] ?? a;
    if (
      Math.max(a.x, b.x) < box.minX ||
      Math.min(a.x, b.x) > box.maxX ||
      Math.max(a.y, b.y) < box.minY ||
      Math.min(a.y, b.y) > box.maxY
    ) {
      continue;
    }
    for (const ps of closed) {
      if (insidePolygon(a, ps)) return true;
      for (let k = 0; k < ps.length; k++) {
        const c = ps[k];
        const d = ps[(k + 1) % ps.length];
        if (segmentDistance(a, b, c, d) < radius) return true;
      }
    }
  }
  return false;
}

/** The distance between segments ab and cd (0 when they cross). */
export function segmentDistance(
  a: CamPoint,
  b: CamPoint,
  c: CamPoint,
  d: CamPoint,
): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}

function segmentsCross(a: CamPoint, b: CamPoint, c: CamPoint, d: CamPoint) {
  const o = (p: CamPoint, q: CamPoint, r: CamPoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0;
}

function pointSegment(p: CamPoint, a: CamPoint, b: CamPoint) {
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

function insidePolygon(p: CamPoint, polygon: CamPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function boundsOf(points: CamPoint[], margin: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  };
}

function mm(v: number) {
  return `${round(v)} mm`;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
