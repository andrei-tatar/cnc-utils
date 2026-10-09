import type { StockOptions } from './stock';
import type { CamPoint3 } from './types';

/**
 * A blank held on a rotary axis (between chuck and tailstock), centred on
 * it. Operations can turn it to an angle first (indexed machining): each is
 * then routed as usual in its own frame — X and Y as the machine moves, Z
 * from the top of the blank as turned — and the G-code turns the axis,
 * raising Z by how much higher (or lower) that top is than at 0°.
 *
 * Angles turn the blank by the right-hand rule round the axis' positive
 * direction (+X or +Y): along X, 90° brings the +Y side up; along Y, the −X
 * side.
 */
export type Rotary = {
  /** The machine axis it lies along. */
  along: 'x' | 'y';
  /** Where the axis is across the table: Y for one along X, X along Y. */
  across: number;
  /**
   * Half the blank's size across the axis (in X or Y) and half its
   * thickness: the axis is that far below its top at 0°.
   */
  halfWidth: number;
  halfThickness: number;
  /**
   * A cylinder (`halfWidth` and `halfThickness` its radius): the same
   * height whichever way it's turned, and no corners to clear.
   */
  round: boolean;
};

/** The rotary axis the stock is held on, or null if it lies on the table. */
export function rotaryOf(stock: StockOptions): Rotary | null {
  if (!stock.enabled || stock.mount !== 'rotary') {
    return null;
  }
  const along = stock.rotaryAlong === 'y' ? 'y' : 'x';
  const round = stock.shape === 'cylinder';
  return along === 'x'
    ? {
        along,
        across: stock.y + stock.height / 2,
        halfWidth: stock.height / 2,
        halfThickness: stock.thickness / 2,
        round,
      }
    : {
        along,
        across: stock.x + stock.width / 2,
        halfWidth: stock.width / 2,
        halfThickness: stock.thickness / 2,
        round,
      };
}

/** Whether `angle` (degrees) turns the blank at all (not whole turns). */
export function isTurned(angle: number | null | undefined): angle is number {
  return !!angle && Math.abs(angle - 360 * Math.round(angle / 360)) > 1e-9;
}

/** The top of the blank turned to `angle`: how far above the axis it is. */
export function rotaryTop(rotary: Rotary, angle: number): number {
  if (rotary.round) {
    return rotary.halfThickness;
  }
  const radians = (angle * Math.PI) / 180;
  return (
    rotary.halfWidth * Math.abs(Math.sin(radians)) +
    rotary.halfThickness * Math.abs(Math.cos(radians))
  );
}

/**
 * How much higher the top is at `angle` than at 0°: what an operation's Z
 * (from the top, as turned) goes up by in the G-code.
 */
export function rotaryShift(rotary: Rotary, angle: number): number {
  return isTurned(angle) ? rotaryTop(rotary, angle) - rotary.halfThickness : 0;
}

/**
 * How far above its top at 0° the blank's corners reach as it turns: safe
 * height is raised by this, so turning it never meets the bit.
 */
export function rotaryClearance(rotary: Rotary): number {
  if (rotary.round) {
    return 0;
  }
  return (
    Math.hypot(rotary.halfWidth, rotary.halfThickness) - rotary.halfThickness
  );
}

/**
 * Where a point the machine reaches (design coordinates, Z from the top at
 * 0° — an operation's Z plus `rotaryShift`) is on the blank while it's
 * turned to `angle`, with the blank back at 0°: what the preview draws.
 */
export function onBlank(
  rotary: Rotary,
  angle: number,
  point: CamPoint3,
): CamPoint3 {
  if (!isTurned(angle)) {
    return point;
  }
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Up from the axis.
  const w = point.z + rotary.halfThickness;
  if (rotary.along === 'x') {
    // Turned by `angle` round +X: (v, w) → (v cos − w sin, v sin + w cos);
    // undo it.
    const v = point.y - rotary.across;
    return {
      x: point.x,
      y: rotary.across + v * cos + w * sin,
      z: -v * sin + w * cos - rotary.halfThickness,
    };
  }
  // Round +Y: (u, w) → (u cos + w sin, −u sin + w cos); undo it.
  const u = point.x - rotary.across;
  return {
    x: rotary.across + u * cos - w * sin,
    y: point.y,
    z: u * sin + w * cos - rotary.halfThickness,
  };
}

/**
 * A point of an operation turned to `angle` (Z from the top as turned) on
 * the blank at 0°.
 */
export function operationPointOnBlank(
  rotary: Rotary,
  angle: number,
  point: CamPoint3,
): CamPoint3 {
  return onBlank(rotary, angle, {
    ...point,
    z: point.z + rotaryShift(rotary, angle),
  });
}

/**
 * Which way round a wrapped design goes, as the axis turns (+1 or −1):
 * so that, unrolled, it reads as drawn seen from outside the stock. Along
 * X a positive turn brings the +Y side up, along Y the −X side.
 */
export function wrapDirection(rotary: Rotary): 1 | -1 {
  return rotary.along === 'x' ? 1 : -1;
}

/**
 * A point of an operation wrapped round a round stock from `angle` (drawn
 * unrolled: across the axis is round it, the axis line at `angle`; Z the
 * depth below the surface) on the blank at 0°.
 */
export function wrappedPointOnBlank(
  rotary: Rotary,
  angle: number,
  point: CamPoint3,
): CamPoint3 {
  const alongX = rotary.along === 'x';
  const across = (alongX ? point.y : point.x) - rotary.across;
  const turned =
    angle +
    wrapDirection(rotary) * (across / rotary.halfThickness) * (180 / Math.PI);
  return onBlank(
    rotary,
    turned,
    alongX
      ? { x: point.x, y: rotary.across, z: point.z }
      : { x: rotary.across, y: point.y, z: point.z },
  );
}

/** How far a point the machine reaches is from the axis (mm). */
export function distanceToAxis(rotary: Rotary, point: CamPoint3): number {
  const across = rotary.along === 'x' ? point.y : point.x;
  return Math.hypot(across - rotary.across, point.z + rotary.halfThickness);
}

/**
 * Which side of the blank `angle` brings up, e.g. "the +Y side up" (null
 * between sides).
 */
export function sideUp(along: 'x' | 'y', angle: number): string | null {
  const quarter = angle / 90;
  if (Math.abs(quarter - Math.round(quarter)) > 1e-9) {
    return null;
  }
  const turn = ((Math.round(quarter) % 4) + 4) % 4;
  const sides =
    along === 'x'
      ? ['the top', 'the +Y side', 'the bottom', 'the −Y side']
      : ['the top', 'the −X side', 'the bottom', 'the +X side'];
  return `${sides[turn]} up`;
}
