import { Rotary } from './rotary';
import { SimulatedSolid, simulateRotaryStock } from './simulate-rotary';
import { CamPath } from './types';

/** 100 along X, 40 across, 40 thick, on an axis along X. */
const rotary: Rotary = {
  along: 'x',
  across: 20,
  halfWidth: 20,
  halfThickness: 20,
  round: false,
};
const stock = { minX: 0, maxX: 100, minY: 0, maxY: 40, top: 0, bottom: -40 };
const tools = { slot: { bitType: 'end-mill', diameter: 10 } };

/** The mesh's volume (positive when its faces face out). */
function volume({ positions: p, index }: SimulatedSolid): number {
  let sum = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    sum +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return sum / 6;
}

/** A slot along X, `depth` deep, with the stock turned to `rotation`. */
function slot(depth: number, rotation?: number): CamPath {
  return {
    sourceShapeId: 's',
    sourceOperationId: 'slot',
    type: 'carve',
    points: [
      { x: 20, y: 20, z: -depth },
      { x: 80, y: 20, z: -depth },
    ],
    ...(rotation === undefined ? {} : { rotation }),
  };
}

describe('simulating a stock on a rotary axis', () => {
  it('leaves the blank whole without cuts, a closed solid facing out', () => {
    const solid = simulateRotaryStock([], tools, rotary, stock, 200_000);
    expect(volume(solid)).toBeCloseTo(100 * 40 * 40, -3);
    // Closed: every edge is shared by two triangles, once each way.
    const edges = new Map<string, number>();
    for (let t = 0; t < solid.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = solid.index[t + e];
        const b = solid.index[t + ((e + 1) % 3)];
        const key = `${a},${b}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      const [a, b] = key.split(',');
      expect(count).toBe(1);
      expect(edges.get(`${b},${a}`))
        .withContext(key)
        .toBe(1);
    }
  });

  it('cuts with the stock turned on the side the turn brings up', () => {
    const solid = simulateRotaryStock(
      [slot(5, 90)],
      tools,
      rotary,
      stock,
      400_000,
    );
    // A 10 wide, 5 deep slot, 60 long with round ends.
    const removed = 60 * 10 * 5 + Math.PI * 25 * 5;
    expect(100 * 40 * 40 - volume(solid)).toBeCloseTo(removed, -2.5);
    // In the +Y side (90° brings it up), half way down: 5 in.
    let reach = -Infinity;
    const p = solid.positions;
    for (let v = 0; v < p.length; v += 3) {
      if (p[v] > 30 && p[v] < 70 && Math.abs(p[v + 2] + 20) < 2) {
        reach = Math.max(reach, p[v + 1]);
      }
    }
    expect(reach).toBeCloseTo(35, 0);
    // The cut's faces are shaded, the blank's own not.
    expect(Math.max(...solid.shade)).toBeGreaterThan(0);
  });

  it('cuts at 0° from the top, as on the table', () => {
    const solid = simulateRotaryStock([slot(5)], tools, rotary, stock);
    let lowest = Infinity;
    const p = solid.positions;
    for (let v = 0; v < p.length; v += 3) {
      if (p[v] > 30 && p[v] < 70 && Math.abs(p[v + 1] - 20) < 2) {
        lowest = Math.min(lowest, p[v + 2] > -10 ? p[v + 2] : Infinity);
      }
    }
    expect(lowest).toBeCloseTo(-5, 0);
  });

  it('leaves a cylinder round, cut where turned', () => {
    const round = { ...rotary, round: true };
    const whole = simulateRotaryStock([], tools, round, stock, 400_000);
    expect(volume(whole)).toBeCloseTo(Math.PI * 20 * 20 * 100, -3);
    // A slot at 90°, 5 deep from the top as turned: 5 in from +Y.
    const solid = simulateRotaryStock(
      [slot(5, 90)],
      tools,
      round,
      stock,
      400_000,
    );
    let reach = -Infinity;
    const p = solid.positions;
    for (let v = 0; v < p.length; v += 3) {
      if (p[v] > 30 && p[v] < 70 && Math.abs(p[v + 2] + 20) < 1) {
        reach = Math.max(reach, p[v + 1]);
      }
    }
    expect(reach).toBeCloseTo(35, 0);
  });
});
