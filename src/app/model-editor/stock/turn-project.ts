import type { BoxAnchor } from '../../../cam/gcode-options';
import type { NumberInput } from '../variables/evaluate';
import type { ModelType } from '../model';

/**
 * Shapes made from other shapes' results: their inputs come turned
 * already, so they're turned back first for their own transforms.
 */
const MADE_FROM_OTHERS = new Set(['copy', 'boolean', 'nest', 'nest-layer']);

/** A number field's value, or the expression it is, negated. */
function negate(value: NumberInput | undefined): NumberInput {
  if (typeof value === 'number') return -value || 0;
  if (value === undefined || value === null || value === '') return 0;
  return `-(${value})`;
}

/** `a + b`, as a number when both are, else as an expression. */
function sum(a: NumberInput | undefined, b: NumberInput | undefined) {
  const zero = (v: NumberInput | undefined) =>
    v === undefined || v === null || v === '' || v === 0;
  if (zero(a)) return b ?? 0;
  if (zero(b)) return a ?? 0;
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  return `${a} + ${b}`;
}

/** `value + degrees` (an angle), as a number when it is one. */
function turned(value: NumberInput | undefined, degrees: number) {
  if (typeof value === 'number' || value === undefined || value === null) {
    return (value ?? 0) + degrees;
  }
  return `(${value}) + ${degrees}`;
}

/**
 * The project as it was, turned a quarter so a stock held on a rotary axis
 * along `from` lies along `to` with everything on it as it was: along Y to
 * along X turns it clockwise ((x, y) → (y, −x)), back anticlockwise. The
 * length runs the same way (the chuck's end stays at the start), designs
 * read as they did (turned, not mirrored), and a rotate step's angle still
 * brings up the same side.
 *
 * Shapes get a rotate transform last (about the origin); those made from
 * other shapes' results also get the opposite first, their own transforms
 * then applying as they did. The stock's corner and size, a corner zero,
 * raster directions and image engravings' pictures turn with them.
 */
export async function turnProject(
  model: ModelType,
  from: 'x' | 'y',
  to: 'x' | 'y',
  newId: () => Promise<string>,
): Promise<ModelType> {
  if (from === to) return model;
  // Clockwise (the rotate transform's positive way) from Y to X.
  const clockwise = from === 'y';
  const degrees = clockwise ? 90 : -90;
  const rotate = async (angle: number) => ({
    id: await newId(),
    disabled: false,
    expanded: false,
    type: 'rotate',
    rotateAngle: angle,
    around: 'point',
    aroundX: 0,
    aroundY: 0,
  });

  const shapes = await Promise.all(
    (model.shapes ?? []).map(async (shape: any) => ({
      ...shape,
      transforms: [
        ...(MADE_FROM_OTHERS.has(shape.type) ? [await rotate(-degrees)] : []),
        ...(shape.transforms ?? []),
        await rotate(degrees),
      ],
    })),
  );

  return {
    ...model,
    shapes,
    stock: turnStock(model.stock, clockwise, to),
    operations: (model.operations ?? []).map((op: any) =>
      turnOperation(op, clockwise),
    ),
  };
}

function turnStock(
  stock: ModelType['stock'],
  clockwise: boolean,
  to: 'x' | 'y',
): ModelType['stock'] {
  if (!stock) return stock;
  const { x, y } = stock;
  // A cylinder's size across the axis is its diameter (not stored).
  const round = stock.mount === 'rotary' && stock.shape === 'cylinder';
  const width = round && to === 'x' ? stock.diameter : stock.width;
  const height = round && to === 'y' ? stock.diameter : stock.height;
  return {
    ...stock,
    rotaryAlong: to,
    // Clockwise: X from Y, Y from −X (and the other way round back).
    // (Number fields can hold expressions: kept as such.)
    x: (clockwise ? y : negate(sum(y, height))) as number,
    y: (clockwise ? negate(sum(x, width)) : x) as number,
    width: height,
    height: width,
    xyZero:
      stock.xyZero === 'design' ||
      stock.xyZero === 'axis-start' ||
      stock.xyZero === 'axis-end'
        ? stock.xyZero
        : turnAnchor(stock.xyZero, clockwise),
  };
}

/** A corner (or side) of a box, where it is once the box is turned. */
function turnAnchor(anchor: BoxAnchor, clockwise: boolean): BoxAnchor {
  const [ax, ay] = anchor.split('-') as [string, string];
  const flip = (side: string) =>
    side.endsWith('min')
      ? side.slice(0, 1) + 'max'
      : side.endsWith('max')
        ? side.slice(0, 1) + 'min'
        : side;
  const rename = (side: string, axis: 'x' | 'y') => axis + side.slice(1);
  // Clockwise: X from Y as it was, Y from X the other way round.
  const nx = clockwise ? rename(ay, 'x') : rename(flip(ay), 'x');
  const ny = clockwise ? rename(flip(ax), 'y') : rename(ax, 'y');
  return `${nx}-${ny}` as BoxAnchor;
}

function turnOperation(op: any, clockwise: boolean): any {
  // A rotary repeat's own operations turn with it.
  if (op.type === 'rotary-repeat') {
    return {
      ...op,
      operations: (op.operations ?? []).map((o: any) =>
        turnOperation(o, clockwise),
      ),
    };
  }
  if ((op.type === 'pocket' || op.type === 'flat') && op.alongAxis) {
    return { ...op, alongAxis: op.alongAxis === 'x' ? 'y' : 'x' };
  }
  if (op.type === 'image-engrave') {
    const alignX = op.imageAlignX ?? 'center';
    const alignY = op.imageAlignY ?? 'middle';
    // Across from up, up from across (one of them reversed).
    const xFromY = { bottom: 'left', middle: 'center', top: 'right' } as const;
    const xFromYReversed = {
      bottom: 'right',
      middle: 'center',
      top: 'left',
    } as const;
    const yFromX = { left: 'bottom', center: 'middle', right: 'top' } as const;
    const yFromXReversed = {
      left: 'top',
      center: 'middle',
      right: 'bottom',
    } as const;
    const rotation = ((op.imageRotation ?? 0) + (clockwise ? 90 : 270)) % 360;
    return {
      ...op,
      imageRotation: rotation,
      // Counter-clockwise degrees: a clockwise turn takes 90 off.
      rasterAngle: turned(op.rasterAngle, clockwise ? -90 : 90),
      imageAlignX: (clockwise ? xFromY : xFromYReversed)[
        alignY as keyof typeof xFromY
      ],
      imageAlignY: (clockwise ? yFromXReversed : yFromX)[
        alignX as keyof typeof yFromX
      ],
      imageOffsetX: clockwise ? op.imageOffsetY : negate(op.imageOffsetY),
      imageOffsetY: clockwise ? negate(op.imageOffsetX) : op.imageOffsetX,
    };
  }
  return op;
}
