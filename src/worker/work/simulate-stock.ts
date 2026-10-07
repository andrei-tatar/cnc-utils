import {
  Heightmap,
  simulateStock as simulate,
  SimulatedStock,
  SimulatedTool,
} from '../../cam/simulate';
import { CamPath } from '../../cam/types';

/** What's left of the stock after the toolpaths (see `simulateStock`). */
export async function simulateStock(
  paths: CamPath[],
  tools: Record<string, SimulatedTool>,
  stock: SimulatedStock,
  maxCells?: number,
): Promise<Heightmap> {
  return simulate(paths, tools, stock, maxCells);
}
