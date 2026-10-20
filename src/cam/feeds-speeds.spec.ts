import {
  ballNoseWidth,
  Cut,
  feedsAndSpeeds,
  ULTIMATE_BEE_1000x1500,
  cuttingMaterial,
  MATERIALS,
  materialById,
  vBitWidth,
} from './feeds-speeds';

describe('feedsAndSpeeds', () => {
  const slot = (
    diameter: number,
    depth: number,
    flutes = 2,
  ): Extract<Cut, { kind: 'mill' }> => ({
    kind: 'mill',
    diameter,
    flutes,
    depth,
    width: diameter,
    loadWidth: diameter,
  });

  it('keeps to the machine’s feed rate and spindle range', () => {
    for (const d of [0.5, 1, 3, 6, 12, 25]) {
      for (const depth of [0.2, d / 2, d * 2]) {
        const result = feedsAndSpeeds(slot(d, depth, 3))!;
        expect(result.feedRate!).toBeLessThanOrEqual(
          ULTIMATE_BEE_1000x1500.maxFeed,
        );
        expect(result.plungeFeedRate).toBeLessThanOrEqual(
          ULTIMATE_BEE_1000x1500.maxPlunge,
        );
        expect(result.spindleSpeed).toBeGreaterThanOrEqual(
          ULTIMATE_BEE_1000x1500.minRpm,
        );
        expect(result.spindleSpeed).toBeLessThanOrEqual(
          ULTIMATE_BEE_1000x1500.maxRpm,
        );
      }
    }
  });

  it('runs a 6 mm end mill at full chip load in a half-deep slot', () => {
    const result = feedsAndSpeeds(slot(6, 3))!;
    expect(result.spindleSpeed).toBe(18600);
    expect(result.chipLoad).toBeCloseTo(0.072, 6);
    expect(result.feedRate).toBe(2670);
    expect(result.notes).toEqual([]);
  });

  it('slows the spindle rather than go past the machine’s feed rate', () => {
    const result = feedsAndSpeeds(slot(6, 3, 3))!;
    expect(result.feedRate).toBe(ULTIMATE_BEE_1000x1500.maxFeed);
    expect(result.spindleSpeed).toBeLessThan(18600);
    expect(result.chipLoad).toBeCloseTo(0.072, 3);
  });

  it('feeds more flutes faster', () => {
    const one = feedsAndSpeeds(slot(3, 1, 1))!;
    const two = feedsAndSpeeds(slot(3, 1, 2))!;
    expect(two.feedRate!).toBeGreaterThan(one.feedRate! * 1.5);
  });

  it('eases off deep cuts, and says to step shallower when it can’t enough', () => {
    const half = feedsAndSpeeds(slot(6, 3))!;
    const full = feedsAndSpeeds(slot(6, 6))!;
    const deep = feedsAndSpeeds(slot(6, 12))!;
    expect(full.chipLoad).toBeLessThan(half.chipLoad);
    expect(deep.chipLoad).toBeCloseTo(half.chipLoad / 2, 6);
    expect(deep.notes.join()).toContain('steps of about 3 mm');
  });

  it('takes a thicker chip feed per tooth on a light stepover', () => {
    const light = feedsAndSpeeds({
      kind: 'mill',
      diameter: 3,
      flutes: 2,
      depth: 0.5,
      width: 0.3,
    })!;
    const full = feedsAndSpeeds(slot(3, 0.5))!;
    expect(light.chipLoad).toBeGreaterThan(full.chipLoad);
    expect(light.chipLoad).toBeLessThanOrEqual(full.chipLoad * 1.5 + 1e-9);
  });

  it('feeds a sloping edge faster for the same chip, up to twice', () => {
    const straight = feedsAndSpeeds(slot(3, 0.5, 1))!;
    const sloping = feedsAndSpeeds({ ...slot(3, 0.5, 1), edge: 0.7 })!;
    const flat = feedsAndSpeeds({ ...slot(3, 0.5, 1), edge: 0.1 })!;
    expect(sloping.chipLoad).toBeCloseTo(straight.chipLoad / 0.7, 6);
    expect(sloping.notes.join()).toContain('1.4×');
    expect(flat.chipLoad).toBeCloseTo(straight.chipLoad * 2, 6);
  });

  it('takes the chip load and the heaviest slot for the bit’s own size', () => {
    // A 12.7 mm 60° V-bit 3 mm deep cuts 3.5 mm wide.
    const narrow = { ...slot(3.46, 3, 1), edge: 1 };
    const vBit = feedsAndSpeeds({ ...narrow, toolDiameter: 12.7 })!;
    expect(feedsAndSpeeds(narrow)!.notes.join()).toContain('eased off');
    expect(vBit.notes).toEqual([]);
    expect(vBit.chipLoad).toBeCloseTo(
      feedsAndSpeeds(slot(12.7, 3, 1))!.chipLoad,
      6,
    );
  });

  it('drills at the plunge rate only, telling to peck deep holes', () => {
    const result = feedsAndSpeeds({ kind: 'drill', diameter: 6, depth: 20 })!;
    expect(result.feedRate).toBeUndefined();
    expect(result.plungeFeedRate).toBeGreaterThan(0);
    expect(result.notes.join()).toContain('peck');
    expect(
      feedsAndSpeeds({ kind: 'drill', diameter: 6, depth: 5 })!.notes,
    ).toEqual([]);
  });

  it('has nothing to say for a bit without a diameter', () => {
    expect(feedsAndSpeeds(slot(0, 1))).toBeNull();
  });
});

describe('woods', () => {
  const slot: Cut = {
    kind: 'mill',
    diameter: 6,
    flutes: 2,
    depth: 3,
    width: 6,
    loadWidth: 6,
  };
  const inWood = (id: string, cut = slot) =>
    feedsAndSpeeds(
      cut,
      ULTIMATE_BEE_1000x1500,
      cuttingMaterial(materialById(id)),
    )!;

  it('have unique ids, and oak is the default', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    expect(materialById(undefined).id).toBe('oak');
    expect(materialById('no such wood').id).toBe('oak');
    expect(inWood('oak')).toEqual(feedsAndSpeeds(slot)!);
  });

  it('take a thicker chip in softer wood, a thinner one in harder', () => {
    const pine = inWood('pine').chipLoad;
    const cherry = inWood('cherry').chipLoad;
    const oak = inWood('oak').chipLoad;
    const maple = inWood('maple').chipLoad;
    const ipe = inWood('ipe').chipLoad;
    expect(pine).toBeGreaterThan(cherry);
    expect(cherry).toBeGreaterThan(oak);
    expect(oak).toBeGreaterThan(maple);
    expect(maple).toBeGreaterThan(ipe);
  });

  it('ease off a deep cut sooner in harder wood', () => {
    const deep = { ...slot, depth: 3.2 };
    expect(inWood('pine', deep).notes.join()).not.toContain('eased off');
    expect(inWood('ipe', deep).notes.join()).toContain('eased off');
  });
});

describe('plastics and aluminium', () => {
  const cut = (
    diameter: number,
    depth: number,
    flutes = 2,
    width = diameter,
  ): Extract<Cut, { kind: 'mill' }> => ({
    kind: 'mill',
    diameter,
    flutes,
    depth,
    width,
    loadWidth: width,
  });
  const inMaterial = (id: string, c: Cut) =>
    feedsAndSpeeds(
      c,
      ULTIMATE_BEE_1000x1500,
      cuttingMaterial(materialById(id)),
    )!;

  it('take a thicker chip in plastic than in oak, a thinner in aluminium', () => {
    const slot = cut(6, 1);
    const oak = inMaterial('oak', slot).chipLoad;
    expect(inMaterial('acrylic-cast', slot).chipLoad).toBeGreaterThan(oak);
    expect(inMaterial('hdpe', slot).chipLoad).toBeGreaterThan(
      inMaterial('acrylic-cast', slot).chipLoad,
    );
    expect(inMaterial('al-6061', slot).chipLoad).toBeLessThan(oak / 2);
  });

  it('take a slot half the bit deep in plastic', () => {
    const notes = inMaterial('acrylic-cast', cut(6, 3)).notes.join();
    expect(notes).not.toContain('eased off');
    expect(notes).not.toContain('heavy');
  });

  it('cut aluminium in shallow steps', () => {
    // A 6 mm slot takes about 0.75 mm at the full chip.
    expect(inMaterial('al-6061', cut(6, 0.7)).notes.join()).not.toContain(
      'eased off',
    );
    expect(inMaterial('al-6061', cut(6, 1)).notes.join()).toContain(
      'eased off',
    );
    expect(inMaterial('al-6061', cut(6, 3)).notes.join()).toContain(
      'steps of about',
    );
    // A light stepover takes a full-depth pass.
    expect(inMaterial('al-6061', cut(6, 6, 2, 0.6)).notes.join()).not.toContain(
      'heavy',
    );
  });

  it('push back harder in harder aluminium', () => {
    const deep = cut(6, 1.2);
    expect(inMaterial('al-7075', deep).chipLoad).toBeLessThan(
      inMaterial('al-6060', deep).chipLoad,
    );
  });

  it('never thin a plastic’s chip below what melts', () => {
    const material = cuttingMaterial(materialById('acrylic-cast'));
    const result = inMaterial('acrylic-cast', cut(6, 12));
    expect(result.chipLoad).toBeGreaterThanOrEqual(
      material.chipLoad(6) * material.minChipShare - 1e-9,
    );
  });

  it('say when a bit has too many flutes, and to blow aluminium chips out', () => {
    expect(inMaterial('acrylic-cast', cut(6, 1, 3)).notes.join()).toContain(
      '3 flutes pack',
    );
    expect(inMaterial('oak', cut(6, 1, 3)).notes.join()).not.toContain(
      'flutes pack',
    );
    expect(inMaterial('al-6061', cut(6, 0.5)).notes.join()).toContain(
      'blow the chips out',
    );
    expect(
      inMaterial('al-6061', {
        kind: 'drill',
        diameter: 5,
        depth: 5,
      }).notes.join(),
    ).toContain('blow the chips out');
  });
});

describe('flute types', () => {
  const cut = (
    flute: Extract<Cut, { kind: 'mill' }>['flute'],
    depth: number,
    width = 6,
  ): Extract<Cut, { kind: 'mill' }> => ({
    kind: 'mill',
    diameter: 6,
    flutes: 2,
    depth,
    width,
    loadWidth: width,
    flute,
  });

  it('cuts an upcut bit as one that doesn’t say', () => {
    expect(feedsAndSpeeds(cut('upcut', 3))).toEqual(
      feedsAndSpeeds(cut(undefined, 3)),
    );
  });

  it('feeds a downcut bit slower the more the cut encloses it', () => {
    const ratio = (depth: number, width: number) =>
      feedsAndSpeeds(cut('downcut', depth, width))!.chipLoad /
      feedsAndSpeeds(cut('upcut', depth, width))!.chipLoad;
    // A slot half the bit deep, then half as wide.
    expect(ratio(3, 6)).toBeCloseTo(1 - 0.125, 6);
    expect(ratio(3, 3)).toBeCloseTo(1 - 0.0625, 6);
    expect(feedsAndSpeeds(cut('downcut', 3))!.notes.join()).toContain(
      'downcut: fed 13% slower',
    );
  });

  it('never feeds a downcut bit so slow it rubs', () => {
    // A slot as deep as the bit is already as slow as it goes.
    const deep = feedsAndSpeeds(cut('downcut', 6))!;
    expect(deep.chipLoad).toBeCloseTo(
      feedsAndSpeeds(cut('upcut', 6))!.chipLoad,
      6,
    );
    expect(deep.notes.join()).toContain('shallower steps clear them better');
  });

  it('leaves a downcut bit alone in a light, shallow cut', () => {
    const light = cut('downcut', 0.5, 1);
    expect(feedsAndSpeeds(light)).toEqual(
      feedsAndSpeeds({ ...light, flute: 'upcut' }),
    );
  });

  it('takes a heavier cut at full chip load with a roughing bit', () => {
    const heavy = 4;
    const upcut = feedsAndSpeeds(cut('upcut', heavy))!;
    const roughing = feedsAndSpeeds(cut('roughing', heavy))!;
    expect(upcut.notes.join()).toContain('eased off');
    expect(roughing.chipLoad).toBeGreaterThan(upcut.chipLoad);
    expect(roughing.notes.join()).toContain('roughing');
    // No difference in a cut light enough for any bit.
    expect(feedsAndSpeeds(cut('roughing', 2))).toEqual(
      feedsAndSpeeds(cut('upcut', 2)),
    );
  });
});

describe('cutting widths', () => {
  it('widens a V-bit with depth, up to its diameter', () => {
    expect(vBitWidth(6, 90, 0, 1)).toBeCloseTo(2, 6);
    expect(vBitWidth(6, 60, 0.2, 0)).toBeCloseTo(0.2, 6);
    expect(vBitWidth(6, 90, 0, 10)).toBe(6);
  });

  it('widens a ball nose with depth, up to its diameter', () => {
    expect(ballNoseWidth(6, 3)).toBe(6);
    expect(ballNoseWidth(6, 1)).toBeCloseTo(2 * Math.sqrt(5), 6);
  });
});
