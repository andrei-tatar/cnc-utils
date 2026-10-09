import { Rotary } from '../../cam/rotary';
import { SimulatedStock, SimulatedTool } from '../../cam/simulate';
import {
  simulateRotaryStock as simulate,
  SimulatedSolid,
} from '../../cam/simulate-rotary';
import { CamPath } from '../../cam/types';

/**
 * What's left of a stock held on a rotary axis after the toolpaths, as a
 * solid (see `simulateRotaryStock`).
 */
export async function simulateRotaryStock(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  rotary: Rotary,
  stock: SimulatedStock,
  maxCells?: number,
): Promise<SimulatedSolid> {
  return simulate(paths, tools, rotary, stock, maxCells);
}
