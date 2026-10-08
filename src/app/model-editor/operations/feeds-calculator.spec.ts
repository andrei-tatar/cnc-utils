import { operationCut } from './feeds-calculator';

describe('operationCut', () => {
  const endMill = { diameter: 6, bitType: 'end-mill' as const, flutes: 3 };

  it('reads a profile as a slot a step deep, with the tool’s flutes', () => {
    const cut = operationCut(
      { type: 'profile', depthMode: 'total', depth: 12, steps: 4 },
      endMill,
      [],
    );
    expect(cut).toEqual({
      kind: 'mill',
      diameter: 6,
      flutes: 3,
      depth: 3,
      width: 6,
      loadWidth: 6,
    });
  });

  it('takes two flutes when the tool doesn’t say', () => {
    const cut = operationCut(
      { type: 'profile', depthMode: 'per-step', depth: 2, steps: 3 },
      { diameter: 6 },
      [],
    );
    expect(cut).toEqual(jasmine.objectContaining({ flutes: 2, depth: 2 }));
  });

  it('reads a pocket’s engagement as the width it cuts', () => {
    const cut = operationCut(
      {
        type: 'pocket',
        depthMode: 'per-step',
        depth: 2,
        steps: 2,
        toolEngagement: 0.4,
      },
      endMill,
      [],
    );
    expect(cut).toEqual(jasmine.objectContaining({ depth: 2, loadWidth: 6 }));
    expect((cut as any).width).toBeCloseTo(2.4, 6);
  });

  it('takes rest machining’s steps from its pocket', () => {
    const pocket = {
      id: 'p',
      type: 'pocket',
      depthMode: 'per-step',
      depth: 1.5,
      steps: 4,
    };
    const cut = operationCut(
      { type: 'rest', pocketOperationId: 'p', toolEngagement: 0.3 },
      { diameter: 3 },
      [pocket],
    );
    expect(cut).toEqual(
      jasmine.objectContaining({ depth: 1.5, width: jasmine.any(Number) }),
    );
    expect((cut as any).width).toBeCloseTo(0.9, 6);
  });

  it('reads a v-carve as a slot as wide as the V at its max depth', () => {
    const vBit = {
      diameter: 12,
      bitType: 'v-bit' as const,
      vAngle: 90,
      tipDiameter: 0,
    };
    const cut = operationCut({ type: 'v-carve', maxDepth: 2 }, vBit, []);
    expect(cut).toEqual(jasmine.objectContaining({ depth: 2 }));
    expect((cut as any).diameter).toBeCloseTo(4, 6);
    // No deeper than the V without a max depth.
    const unlimited = operationCut(
      { type: 'v-carve', unlimitedDepth: true, maxDepth: 2 },
      vBit,
      [],
    );
    expect((unlimited as any).depth).toBeCloseTo(6, 6);
  });

  it('drills a peck at a time', () => {
    expect(
      operationCut(
        { type: 'drill', depth: 20, peck: 5 },
        { diameter: 5, bitType: 'drill' },
        [],
      ),
    ).toEqual({ kind: 'drill', diameter: 5, depth: 5 });
  });

  it('has nothing without a tool', () => {
    expect(operationCut({ type: 'pocket' }, undefined, [])).toBeNull();
  });
});
