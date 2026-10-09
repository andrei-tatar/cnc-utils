import type { Observable } from 'rxjs';

export type CamPoint = { x: number; y: number };
export type CamPoint3 = { x: number; y: number; z: number };

/**
 * A polygon's vertex. With a `bulge`, the segment to the next vertex is a
 * circular arc: `tan(sweep / 4)`, positive counter-clockwise (see
 * `src/cam/arcs.ts`); without, a straight line.
 */
export type CamVertex = { x: number; y: number; bulge?: number };

/** Lines and arcs, closed or open (see CamVertex). */
export type CamPolygon = {
  vertices: CamVertex[];
  close: boolean;
};

export type CamShape = {
  sourceShapeId: string;
  polygons: CamPolygon[];
  /** Material every operation leaves standing (see `src/cam/tabs.ts`). */
  tabs?: CamTab[];
};

/**
 * A tab: a bridge of material holding a part to the stock. Nothing cuts
 * below `top` within its footprint.
 */
export type CamTab = {
  /** Its footprint: a convex polygon. */
  points: CamPoint[];
  /** Z of its top (≤ 0). */
  top: number;
};

/**
 * What the preview should emphasize. With operations listed, only their
 * toolpaths are highlighted; otherwise toolpaths of the listed shapes are.
 * Shape outlines follow `shapes`. Both empty highlights everything.
 */
export type Highlight = {
  shapes: string[];
  operations: string[];
};

export type ShapeSource = {
  name: string;
  shape$: Observable<CamShape[]>;
};

export type CamPath = {
  sourceShapeId: string;
  /** The operation that produced this path, when known. */
  sourceOperationId?: string;
  points: CamPoint3[];
  type: 'travel' | 'carve';
  /**
   * How far the stock on a rotary axis is turned for this path (degrees;
   * left out when it isn't): its points are then in that frame, Z from the
   * top as turned (see `operationPointOnBlank` in rotary.ts).
   */
  rotation?: number;
  /**
   * Cuts only: the feed rate (mm/min) of the move to each point, one per
   * point (the first point's is the rate in effect where the path starts).
   */
  feeds?: number[];
};
