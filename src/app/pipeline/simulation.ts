import { SimulatedStock, SimulatedTool } from '../../cam/simulate';
import { resolveStock } from '../../cam/stock';
import { Rotary, rotaryOf } from '../../cam/rotary';
import { cutOperations } from '../model-editor/operations/flatten';
import { CamPath } from '../../cam/types';
import { ModelType } from '../model-editor/model';

/** Room left round the cuts when there's no stock to simulate (mm). */
const MARGIN = 5;

/**
 * How finely the material is simulated: about how many cells the block is
 * split into. Time and memory grow with it (the solid drawn takes about
 * 120 bytes a cell).
 */
export const SIMULATION_CELLS = {
  draft: 150_000,
  standard: 400_000,
  fine: 4_000_000,
  finest: 8_000_000,
} as const;

export type SimulationQuality = keyof typeof SIMULATION_CELLS;

const QUALITY_STORAGE_KEY = 'ui.simulationQuality';

/** The quality last chosen in this browser (standard at first). */
export function loadSimulationQuality(): SimulationQuality {
  try {
    const value = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (value && value in SIMULATION_CELLS) {
      return value as SimulationQuality;
    }
  } catch {}
  return 'standard';
}

export function saveSimulationQuality(quality: SimulationQuality) {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, quality);
  } catch {}
}

/** What the simulation needs (see `simulationInput`). */
export type SimulationInput = {
  tools: Record<string, SimulatedTool>;
  stock: SimulatedStock;
  /**
   * The rotary axis the stock is held on, if it is: then cuts are made with
   * it turned (`simulateRotaryStock`), and what's left is a solid.
   */
  rotary: Rotary | null;
};

/**
 * What the simulation needs: each enabled operation's bit, and the block of
 * material (the stock, or one round the cuts). Null with nothing to cut.
 */
export function simulationInput(
  paths: CamPath[],
  model: ModelType,
): SimulationInput | null {
  const tools: Record<string, SimulatedTool> = {};
  let widest = 0;
  for (const op of cutOperations(model.operations)) {
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
      rotary: rotaryOf(stock),
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
    rotary: null,
  };
}
