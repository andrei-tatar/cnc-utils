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
};

export type ShapeSource = {
  name: string;
  shape$: Observable<CamShape[]>;
};

export type CamPath = {
  sourceShapeId: string;
  points: CamPoint3[];
  type: 'travel' | 'carve';
};
