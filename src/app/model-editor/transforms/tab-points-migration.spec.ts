import { migrateModel } from '../model';

describe('tab points migration', () => {
  const migrated = (transform: any) =>
    migrateModel({
      shapes: [{ id: 's', type: 'circle', transforms: [transform] }],
    }).shapes[0].transforms[0] as any;

  it('turns the "x, y" lines into a list of points', () => {
    const tabs = migrated({
      id: 't',
      type: 'tabs',
      tabPlacement: 'points',
      tabPoints: 'x, y\n10, 20\n-5 7.5\n',
    });
    expect(tabs.tabPoints).toEqual([
      { id: 't-0', x: 10, y: 20 },
      { id: 't-1', x: -5, y: 7.5 },
    ]);
  });

  it('leaves a list of points as it is', () => {
    const tabPoints = [{ id: 'p', x: 'a / 2', y: 3 }];
    expect(migrated({ id: 't', type: 'tabs', tabPoints }).tabPoints).toBe(
      tabPoints,
    );
  });
});
