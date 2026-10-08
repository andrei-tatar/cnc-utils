/**
 * Suggested feeds and speeds for cutting hardwood on a hobby router: chip
 * load per tooth from the bit's (effective) diameter, thinned for light
 * stepovers, eased off for heavy cuts the frame can't take, at a spindle
 * speed that keeps the chip load within the machine's top feed rate.
 */

/** What the machine can do. */
export type Machine = {
  id: string;
  name: string;
  minRpm: number;
  maxRpm: number;
  /** Fastest it cuts without losing steps or chattering (mm/min). */
  maxFeed: number;
  maxPlunge: number;
  /**
   * The heaviest cut it takes at the full chip load: a slot this deep for
   * a bit this wide (`slotDepth` × diameter, the depth at most
   * `maxSlotDepth` mm). Heavier cuts take a thinner chip.
   */
  slotDepth: number;
  maxSlotDepth: number;
};

/**
 * Ultimate Bee 1000 × 1500: ball screws, 3 N·m closed-loop steppers (no
 * lost steps), a 2.2 kW water-cooled spindle (ER20, 24 000 RPM, little
 * torque below about 8 000). The aluminium extrusions flex before the
 * motors run out, so it cuts well below the speed the screws move at.
 */
export const ULTIMATE_BEE_1000x1500: Machine = {
  id: 'ultimate-bee-1000x1500',
  name: 'Ultimate Bee 1000 × 1500, 2.2 kW',
  minRpm: 8000,
  maxRpm: 24000,
  maxFeed: 3500,
  maxPlunge: 800,
  slotDepth: 0.5,
  maxSlotDepth: 5,
};

/** Machines to pick from (the G-code section's `machine`). */
export const MACHINES: readonly Machine[] = [ULTIMATE_BEE_1000x1500];

export const DEFAULT_MACHINE = ULTIMATE_BEE_1000x1500.id;

/** The machine with this id, or the default one. */
export function machineById(id: string | null | undefined): Machine {
  return (
    MACHINES.find((machine) => machine.id === id) ?? ULTIMATE_BEE_1000x1500
  );
}

/** How a material is cut. */
export type Material = {
  name: string;
  /** Cutting edge speed for router bits (m/min). */
  surfaceSpeed: number;
  /** Same for drills, which cut slower (m/min). */
  drillSurfaceSpeed: number;
  /** Chip load per tooth for a bit of `diameter` mm (mm). */
  chipLoad(diameter: number): number;
  /** Drill feed per revolution for a drill of `diameter` mm (mm). */
  drillFeed(diameter: number): number;
  /** Thinner chips than this share of `chipLoad` rub and burn. */
  minChipShare: number;
  /**
   * How hard it pushes back on the bit at its full chip load (`chipLoad`),
   * oak being 1: the machine's heaviest cut is set in oak.
   */
  load: number;
};

export type WoodGroup = 'softwood' | 'hardwood' | 'exotic' | 'sheet';

/** A wood to cut, by how hard it is. */
export type Wood = {
  id: string;
  name: string;
  group: WoodGroup;
  /**
   * Janka hardness (lbf); for sheet goods, that of a wood cutting about
   * the same.
   */
  janka: number;
};

/** The hardness feeds and speeds are set for: oak's. */
const REFERENCE_JANKA = 1290;

/**
 * Woods to pick from, softest first in each group. Janka hardness from the
 * Wood Database (European species where they're the usual ones).
 */
export const WOODS: readonly Wood[] = [
  { id: 'cedar', name: 'cedar (western red)', group: 'softwood', janka: 350 },
  { id: 'spruce', name: 'spruce', group: 'softwood', janka: 380 },
  { id: 'fir', name: 'fir', group: 'softwood', janka: 400 },
  { id: 'pine', name: 'pine', group: 'softwood', janka: 540 },
  { id: 'larch', name: 'larch', group: 'softwood', janka: 740 },
  { id: 'linden', name: 'linden / basswood', group: 'hardwood', janka: 450 },
  { id: 'poplar', name: 'poplar', group: 'hardwood', janka: 500 },
  { id: 'alder', name: 'alder', group: 'hardwood', janka: 590 },
  { id: 'elm', name: 'elm', group: 'hardwood', janka: 830 },
  { id: 'cherry', name: 'cherry', group: 'hardwood', janka: 950 },
  { id: 'walnut', name: 'walnut', group: 'hardwood', janka: 1010 },
  { id: 'birch', name: 'birch', group: 'hardwood', janka: 1210 },
  { id: 'oak', name: 'oak', group: 'hardwood', janka: 1290 },
  { id: 'ash', name: 'ash', group: 'hardwood', janka: 1320 },
  { id: 'beech', name: 'beech', group: 'hardwood', janka: 1450 },
  { id: 'maple', name: 'maple (hard)', group: 'hardwood', janka: 1450 },
  {
    id: 'acacia',
    name: 'acacia / black locust',
    group: 'hardwood',
    janka: 1700,
  },
  { id: 'hornbeam', name: 'hornbeam', group: 'hardwood', janka: 1780 },
  { id: 'hickory', name: 'hickory', group: 'hardwood', janka: 1820 },
  { id: 'mahogany', name: 'mahogany', group: 'exotic', janka: 800 },
  { id: 'teak', name: 'teak', group: 'exotic', janka: 1070 },
  { id: 'sapele', name: 'sapele', group: 'exotic', janka: 1410 },
  { id: 'wenge', name: 'wenge', group: 'exotic', janka: 1630 },
  { id: 'zebrawood', name: 'zebrawood', group: 'exotic', janka: 1830 },
  { id: 'padauk', name: 'padauk', group: 'exotic', janka: 1970 },
  { id: 'purpleheart', name: 'purpleheart', group: 'exotic', janka: 2520 },
  { id: 'ipe', name: 'ipe', group: 'exotic', janka: 3510 },
  { id: 'mdf', name: 'MDF', group: 'sheet', janka: 950 },
  { id: 'plywood', name: 'plywood (birch)', group: 'sheet', janka: 1100 },
];

export const DEFAULT_WOOD = 'oak';

/** The wood with this id, or oak. */
export function woodById(id: string | null | undefined): Wood {
  return (
    WOODS.find((wood) => wood.id === id) ??
    WOODS.find((wood) => wood.id === DEFAULT_WOOD)!
  );
}

/**
 * How `wood` cuts with carbide bits on a hobby machine: softer woods take a
 * thicker chip (a thin one tears and fuzzes them) and push back less;
 * harder ones the other way round.
 */
export function woodMaterial(wood: Wood): Material {
  const softer = REFERENCE_JANKA / wood.janka;
  const chip = clamp(softer ** 0.35, 0.7, 1.4);
  return {
    name: wood.name,
    surfaceSpeed: 350,
    drillSurfaceSpeed: 100,
    chipLoad: (diameter) => chip * clamp(0.012 * diameter, 0.01, 0.12),
    drillFeed: (diameter) => chip * clamp(0.015 * diameter, 0.02, 0.12),
    minChipShare: 0.5,
    // Force goes with the chip, and about with the root of the hardness.
    load: chip * Math.sqrt(1 / softer),
  };
}

/**
 * A cut, as feeds and speeds see it. `diameter` is how wide the bit cuts
 * (a V-bit's or ball nose's width at the depth it goes to).
 */
export type Cut =
  | {
      kind: 'mill';
      diameter: number;
      flutes: number;
      /** Depth of each pass (mm). */
      depth: number;
      /** How much of the bit's width is in the material (mm), a slot's all. */
      width: number;
      /**
       * Width the load is worked out for, when more than `width` (a
       * pocket's corners and first pass take more than its stepover).
       */
      loadWidth?: number;
      /**
       * The bit's own diameter, when more than `diameter` (a V-bit or ball
       * nose cutting with less than its full width): the chip load goes
       * with it.
       */
      toolDiameter?: number;
      /**
       * How thick a chip the edge cuts for each mm fed per tooth, where it's
       * thickest: 1 for a straight side, less where the edge slopes in the
       * cut (a V-bit's flank, cos(V/2); a ball nose below its middle, its
       * width there ÷ its diameter). Fed faster to make up, up to twice.
       */
      edge?: number;
    }
  | {
      kind: 'drill';
      diameter: number;
      /** How deep the hole goes in one go (mm). */
      depth: number;
    };

export type FeedsAndSpeeds = {
  /** RPM. */
  spindleSpeed: number;
  /** mm/min; absent for drilling, which only plunges. */
  feedRate?: number;
  plungeFeedRate: number;
  /** mm per tooth (per revolution for a drill). */
  chipLoad: number;
  /** Why the numbers are what they are, or what would cut faster. */
  notes: string[];
};

/** Feeds and speeds for `cut` in `material` on `machine`. */
export function feedsAndSpeeds(
  cut: Cut,
  machine: Machine = ULTIMATE_BEE_1000x1500,
  material: Material = woodMaterial(woodById(DEFAULT_WOOD)),
): FeedsAndSpeeds | null {
  if (!(cut.diameter > 0)) {
    return null;
  }
  return cut.kind === 'drill'
    ? drilling(cut, machine, material)
    : milling(cut, machine, material);
}

function milling(
  cut: Extract<Cut, { kind: 'mill' }>,
  machine: Machine,
  material: Material,
): FeedsAndSpeeds {
  const notes: string[] = [];
  const d = cut.diameter;
  const flutes = Math.max(1, Math.round(cut.flutes) || 1);
  const depth = Math.max(cut.depth, 0);
  const width = clamp(cut.width, 0, d);
  // The bit's own diameter: the chip load and its stiffness go with it.
  const size = Math.max(cut.toolDiameter ?? 0, d);
  const base = material.chipLoad(size);

  // A light stepover makes a thinner chip than the feed per tooth, and so
  // does a sloping edge: feed faster so it's as thick as it should be (to
  // half again as fast for the stepover, twice for both). `chip` is the
  // feed per tooth, `edge` × `chip` the chip the edge cuts.
  const edge = clamp(cut.edge ?? 1, 0.5, 1);
  let stepover = 1;
  if (width > 0 && width < d / 2) {
    stepover = Math.min(1.5, 1 / Math.sqrt(1 - (1 - (2 * width) / d) ** 2));
  }
  let chip = base * Math.min(2, stepover / edge);
  if (edge < 0.95) {
    notes.push(
      `${times(Math.min(2, 1 / edge))} the feed per tooth: the sloping edge cuts a thinner chip`,
    );
  }

  // A cut heavier than the machine's slot at full chip load (for a bit
  // this size) takes a thinner chip, down to where it would burn. The load
  // goes with the chip's cross-section, chip × width × depth, and with the
  // wood.
  const loadWidth = Math.max(width, Math.min(cut.loadWidth ?? 0, d));
  const slotDepth = Math.min(machine.slotDepth * size, machine.maxSlotDepth);
  const load =
    ((chip * edge) / base) *
    ((loadWidth * depth * material.load) / (size * slotDepth));
  if (load > 1) {
    const eased = chip / load;
    const least = (base * material.minChipShare) / edge;
    if (eased < least) {
      // The depth that takes the full chip.
      const fits = depth / load;
      chip = least;
      notes.push(
        `${mm(depth)} deep is heavy for this bit on this machine: steps of about ${mm(fits)} would cut faster and cleaner`,
      );
    } else {
      chip = eased;
      notes.push(
        `eased off ${percent(1 - 1 / load)} for the ${mm(depth)} depth`,
      );
    }
  }

  // Fast enough for a clean cut, slow enough for the feed to keep up.
  let rpm = clamp(
    (material.surfaceSpeed * 1000) / (Math.PI * d),
    machine.minRpm,
    machine.maxRpm,
  );
  let feed = rpm * flutes * chip;
  if (feed > machine.maxFeed) {
    rpm = Math.max(machine.minRpm, machine.maxFeed / (flutes * chip));
    feed = Math.min(machine.maxFeed, rpm * flutes * chip);
    // Thinner still where even the slowest spindle is too fast.
    chip = feed / (rpm * flutes);
    notes.push(
      `held to the machine’s ${machine.maxFeed} mm/min, the spindle slowed to match`,
    );
  }

  const spindleSpeed = round(rpm, 100);
  const feedRate = round(feed, 10);
  return {
    spindleSpeed,
    feedRate,
    plungeFeedRate: round(Math.min(machine.maxPlunge, feed / 3), 10),
    chipLoad: chip,
    notes,
  };
}

function drilling(
  cut: Extract<Cut, { kind: 'drill' }>,
  machine: Machine,
  material: Material,
): FeedsAndSpeeds {
  const notes: string[] = [];
  const d = cut.diameter;
  const rpm = clamp(
    (material.drillSurfaceSpeed * 1000) / (Math.PI * d),
    machine.minRpm,
    machine.maxRpm,
  );
  let perRev = material.drillFeed(d);
  let feed = rpm * perRev;
  if (feed > machine.maxPlunge) {
    feed = machine.maxPlunge;
    perRev = feed / rpm;
  }
  if (cut.depth > 3 * d) {
    notes.push(`over 3× its diameter deep: peck to clear the chips`);
  }
  return {
    spindleSpeed: round(rpm, 100),
    plungeFeedRate: round(feed, 10),
    chipLoad: perRev,
    notes,
  };
}

/** How wide a V-bit cuts `depth` below its tip (never wider than it is). */
export function vBitWidth(
  diameter: number,
  vAngle: number,
  tipDiameter: number,
  depth: number,
): number {
  const half = (Math.min(Math.max(vAngle, 1), 179) * Math.PI) / 360;
  return Math.min(
    diameter,
    tipDiameter + 2 * Math.max(depth, 0) * Math.tan(half),
  );
}

/** How wide a ball nose cuts `depth` deep. */
export function ballNoseWidth(diameter: number, depth: number): number {
  const r = diameter / 2;
  return depth >= r
    ? diameter
    : 2 * Math.sqrt(Math.max(depth, 0) * (diameter - depth));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, step: number) {
  return Math.max(step, Math.round(value / step) * step);
}

function mm(value: number) {
  return `${Math.round(value * 1000) / 1000} mm`;
}

function times(value: number) {
  return `${Math.round(value * 10) / 10}×`;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
