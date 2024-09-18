import { Observable } from 'rxjs';

export type CamPoint = { x: number; y: number };

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
