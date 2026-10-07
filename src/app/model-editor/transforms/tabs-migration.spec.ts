import { migrateModel } from '../model';

describe('tabs from profiles', () => {
  const profile = {
    id: 'p',
    type: 'profile',
    shapeId: 's',
    toolId: 't',
    side: 'outside',
    mode: 'contours',
    startDepth: 0,
    depth: 6,
    steps: 3,
    tabsEnabled: true,
    tabCount: 3,
    tabWidth: 8,
    tabHeight: 2.5,
    tabOffset: 4,
  };

  it('moves a profile’s tabs to its shape', () => {
    const model = migrateModel({
      shapes: [{ id: 's', type: 'circle', transforms: [] }],
      tools: [{ id: 't', diameter: 6 }],
      operations: [profile],
    });
    const op = model.operations[0] as any;
    expect('tabsEnabled' in op || 'tabHeight' in op).toBeFalse();
    expect(model.shapes[0].transforms).toEqual([
      {
        id: 'tabs-s',
        expanded: false,
        disabled: false,
        type: 'tabs',
        tabsOn: 'contours',
        tabSide: 'outside',
        tabCount: 3,
        tabWidth: 8,
        tabLength: 10,
        // The cut's bottom (6 × 3) less the tab height.
        tabDepth: 15.5,
        tabOffset: 4,
      },
    ] as any);
    // Migrating again changes nothing.
    expect(migrateModel(model)).toEqual(model);
  });

  it('keeps expressions as expressions', () => {
    const model = migrateModel({
      shapes: [{ id: 's', type: 'circle', transforms: [] }],
      tools: [],
      operations: [
        { ...profile, side: 'on-line', depthMode: 'total', depth: 'thick + 1' },
      ],
    });
    const tabs = model.shapes[0].transforms[0] as any;
    expect(tabs.tabDepth).toBe('(thick + 1) - 2.5');
    expect(tabs.tabSide).toBe('both');
  });

  it('adds nothing for profiles without tabs', () => {
    const model = migrateModel({
      shapes: [{ id: 's', type: 'circle', transforms: [] }],
      tools: [],
      operations: [{ ...profile, tabsEnabled: false }],
    });
    expect(model.shapes[0].transforms).toEqual([]);
    expect('tabCount' in (model.operations[0] as any)).toBeFalse();
  });
});
