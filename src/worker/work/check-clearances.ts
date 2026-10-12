import {
  checkClearances,
  ClearanceReport,
  ClearanceTool,
} from '../../cam/clearance';
import { SimulatedStock } from '../../cam/simulate';
import { CamPath } from '../../cam/types';

/**
 * What the job's moves run into (see `checkClearances`): rapids into uncut
 * material, the shank above the flutes, the collet nut.
 */
export async function jobClearances(
  paths: CamPath[],
  tools: Record<string, ClearanceTool>,
  stock: SimulatedStock,
  holderDiameter: number,
): Promise<ClearanceReport> {
  return checkClearances(paths, tools, stock, holderDiameter);
}
