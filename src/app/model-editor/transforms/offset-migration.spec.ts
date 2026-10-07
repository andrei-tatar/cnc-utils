import { migrateModel } from '../model';

describe('offset transform migration', () => {
  const migrated = (transform: any) =>
    migrateModel({
      shapes: [{ id: 's', type: 'circle', transforms: [transform] }],
    }).shapes[0].transforms;

  it('renames clipper-inflate to offset, its miter limit in its own field', () => {
    expect(
      migrated({
        id: 'i',
        expanded: false,
        type: 'clipper-inflate',
        offset: 3,
        joinType: 'miter',
        endType: 'polygon',
        precision: 0.05,
        miterLimit: 2,
        arcTolerance: 0,
      }),
    ).toEqual([
      {
        id: 'i',
        expanded: false,
        type: 'offset',
        offset: 3,
        joinType: 'miter',
        endType: 'polygon',
        // "precision" was the miter limit; "miter limit", the decimal
        // places, now come from the project's geometry precision.
        miterLimit: 0.05,
        arcTolerance: 0,
      } as any,
    ]);
  });

  it('leaves an offset as it is', () => {
    const offset = {
      id: 'o',
      expanded: false,
      type: 'offset',
      offset: 3,
      joinType: 'round',
      endType: 'polygon',
      miterLimit: 2,
      arcTolerance: 0,
    };
    expect(migrated(offset)).toEqual([offset as any]);
  });
});
