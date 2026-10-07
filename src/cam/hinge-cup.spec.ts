import { bowtieOutline, hingeCupLayout, hingeCupPolygons } from './hinge-cup';

describe('hinge cup', () => {
  const blum = {
    cupDiameter: 35,
    boring: 5,
    screwSpacing: 45,
    screwOffset: 9.5,
    screwDiameter: 0,
    parts: 'both' as const,
  };

  it('puts the cup its boring distance from the edge', () => {
    const { cup, screws } = hingeCupLayout(blum);
    expect(cup).toEqual({ x: 0, y: -22.5 });
    expect(screws).toEqual([
      { x: -22.5, y: -32 },
      { x: 22.5, y: -32 },
    ]);
  });

  it('makes the screw holes points to drill unless sized', () => {
    const polygons = hingeCupPolygons(blum, 0.01);
    expect(polygons.length).toBe(3);
    expect(polygons[1]).toEqual({
      points: [{ x: -22.5, y: -32 }],
      close: false,
    });
    const sized = hingeCupPolygons({ ...blum, screwDiameter: 8 }, 0.01);
    expect(sized[1].close).toBeTrue();
    expect(hingeCupPolygons({ ...blum, parts: 'cup' }, 0.01).length).toBe(1);
  });

  it('draws a bowtie narrower at its waist', () => {
    const outline = bowtieOutline(60, 30, 12);
    expect(outline.length).toBe(6);
    expect(outline[1]).toEqual({ x: 0, y: -6 });
    expect(outline[3]).toEqual({ x: 30, y: 15 });
  });
});
