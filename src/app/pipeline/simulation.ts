import { SimulatedStock, SimulatedTool } from '../../cam/simulate';
import { resolveStock } from '../../cam/stock';
import { CamPath } from '../../cam/types';
import { ModelType } from '../model-editor/model';

/** Room left round the cuts when there's no stock to simulate (mm). */
const MARGIN = 5;

/**
 * What the simulation needs: each operation's bit, and the block of
 * material (the stock, or one round the cuts). Null with nothing to cut.
 */
export function simulationInput(
  paths: CamPath[],
  model: ModelType,
): { tools: Record<string, SimulatedTool>; stock: SimulatedStock } | null {
  const tools: Record<string, SimulatedTool> = {};
  let widest = 0;
  for (const op of model.operations ?? []) {
    const tool = model.tools.find((t) => t.id === op.toolId);
    if (!tool || !(tool.diameter > 0)) continue;
    tools[op.id] = {
      bitType: tool.bitType ?? 'end-mill',
      diameter: tool.diameter,
      vAngle: tool.vAngle,
      tipDiameter: tool.tipDiameter,
      cornerRadius: tool.cornerRadius,
      pointAngle: tool.pointAngle,
    };
    widest = Math.max(widest, tool.diameter);
  }

  const stock = resolveStock(model.stock);
  if (stock.enabled) {
    return {
      tools,
      stock: {
        minX: stock.x,
        minY: stock.y,
        maxX: stock.x + stock.width,
        maxY: stock.y + stock.height,
        top: 0,
        bottom: -stock.thickness,
      },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let deepest = 0;
  for (const path of paths) {
    if (path.type !== 'carve') continue;
    for (const p of path.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      deepest = Math.min(deepest, p.z);
    }
  }
  if (!(maxX >= minX) || deepest >= 0) {
    return null;
  }
  const pad = widest / 2 + MARGIN;
  return {
    tools,
    stock: {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
      top: 0,
      bottom: deepest - 1,
    },
  };
}
