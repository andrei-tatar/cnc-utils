import { Rotary } from '../../cam/rotary';
import { Heightmap, SimulatedStock, SimulatedTool } from '../../cam/simulate';
import {
  rotaryHeightmap,
  SimulatedSolid,
  solidUnder,
} from '../../cam/simulate-rotary';
import { CamPath } from '../../cam/types';

/**
 * What the cuts made with a stock on a rotary axis turned to one angle
 * leave, as a heightmap in that angle's frame (see `rotaryHeightmap`): a
 * job per angle, so they're simulated side by side and an angle whose cuts
 * didn't change isn't simulated again.
 */
export async function simulateRotaryAngle(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells: number,
  at: { angle: number; wrapped?: boolean },
): Promise<Heightmap> {
  return rotaryHeightmap(paths, tools, rotary, stock, maxCells, at);
}

/**
 * What's left of a stock held on a rotary axis under every angle's
 * heightmap, as a solid (see `solidUnder`).
 */
export async function rotarySolidUnder(
  maps: { angle: number; wrapped?: true; map: Heightmap }[],
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells?: number,
): Promise<SimulatedSolid> {
  return solidUnder(maps, rotary, stock, maxCells);
}
