import { migrateModel } from '../model';

describe('shape point lists migration', () => {
  const migrated = (shape: any) =>
    migrateModel({ shapes: [shape] }).shapes[0] as any;

  it('turns a points shape\'s "x, y" lines into a list of points', () => {
    const shape = migrated({
      id: 's',
      type: 'points',
      pointsMode: 'list',
      pointsList: '0, 0\n20 0\nfoo\n20;20',
    });
    expect(shape.pointsList).toEqual([
      { id: 's-0', x: 0, y: 0 },
      { id: 's-1', x: 20, y: 0 },
      { id: 's-2', x: 20, y: 20 },
    ]);
  });

  it('turns a polyline\'s "x, y" lines into a list of points', () => {
    const shape = migrated({
      id: 'l',
      type: 'polyline',
      polylinePoints: '0, 0\n50, 20',
      polylineClosed: true,
    });
    expect(shape.polylinePoints).toEqual([
      { id: 'l-0', x: 0, y: 0 },
      { id: 'l-1', x: 50, y: 20 },
    ]);
    expect(shape.polylineClosed).toBeTrue();
  });

  it('leaves a list of points as it is', () => {
    const polylinePoints = [{ id: 'p', x: 'a / 2', y: 3 }];
    expect(
      migrated({ id: 'l', type: 'polyline', polylinePoints }).polylinePoints,
    ).toBe(polylinePoints);
  });
});
