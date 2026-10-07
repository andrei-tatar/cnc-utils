import type { Observable } from 'rxjs';

export type CamPoint = { x: number; y: number };
export type CamPoint3 = { x: number; y: number; z: number };

export type CamPolygon = {
  points: CamPoint[];
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
};
