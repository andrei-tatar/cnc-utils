import { circlePolygon } from './corners';
import { CamPoint, CamPolygon } from './types';

export type HingeCup = {
  cupDiameter: number;
  /** From the edge (y = 0) to the cup's edge. */
  boring: number;
  screwSpacing: number;
  /** From the cup's centre further from the edge to the screws' line. */
  screwOffset: number;
  /** 0: the screw holes are single points. */
  screwDiameter: number;
  parts: 'both' | 'cup' | 'screws';
};

/** Where a hinge cup's centre and screw holes are (the edge along y = 0). */
export function hingeCupLayout({
  cupDiameter,
  boring,
  screwSpacing,
  screwOffset,
}: HingeCup): { cup: CamPoint; screws: CamPoint[] } {
  const cup = { x: 0, y: -(boring + cupDiameter / 2) };
  const y = cup.y - screwOffset;
  return {
    cup,
    screws: [
      { x: -screwSpacing / 2, y },
      { x: screwSpacing / 2, y },
    ],
  };
}

/** A hinge cup's holes as polygons: circles, and points for unsized screws. */
export function hingeCupPolygons(
  hinge: HingeCup,
  curveTolerance: number,
): CamPolygon[] {
  const { cup, screws } = hingeCupLayout(hinge);
  const polygons: CamPolygon[] = [];
  if (hinge.parts !== 'screws' && hinge.cupDiameter > 0) {
    polygons.push(circlePolygon(cup, hinge.cupDiameter / 2, curveTolerance));
  }
  if (hinge.parts !== 'cup') {
    for (const screw of screws) {
      polygons.push(
        hinge.screwDiameter > 0
          ? circlePolygon(screw, hinge.screwDiameter / 2, curveTolerance)
          : { points: [screw], close: false },
      );
    }
  }
  return polygons;
}

/** The bowtie's outline, centred on 0, 0, along X. */
export function bowtieOutline(
  length: number,
  endWidth: number,
  waist: number,
): CamPoint[] {
  const l = Math.max(0, length) / 2;
  const e = Math.max(0, endWidth) / 2;
  const w = Math.min(Math.max(0, waist), Math.max(0, endWidth)) / 2;
  return [
    { x: -l, y: -e },
    { x: 0, y: -w },
    { x: l, y: -e },
    { x: l, y: e },
    { x: 0, y: w },
    { x: -l, y: e },
  ];
}
