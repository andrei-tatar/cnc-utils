import { CamPoint } from '../../cam/types';
import { ModelType } from './model';

/**
 * A point of a shape that can be dragged in the preview: a polyline's or a
 * point list's point, or a path command's point (or a curve's control
 * point).
 */
export type EditHandle = {
  /** Where it is, in design coordinates. */
  x: number;
  y: number;
  /** A curve's control point rather than a point on the shape. */
  control: boolean;
  /** One of its coordinates is an expression: shown, not dragged. */
  locked: boolean;
  /** The list (of the shape) the point is in, and its item. */
  list: 'polylinePoints' | 'pointsList' | 'pathCommands';
  itemId: string;
  /** Its coordinates' keys in the item; null: it has none (H, V). */
  xKey: string | null;
  yKey: string | null;
  /**
   * What its coordinates are measured from: the shape's moves (translate
   * transforms), and for a relative path command the point it starts at.
   */
  base: CamPoint;
};

/** The shape being edited in the preview, and its points. */
export type ShapeEditing = {
  shapeId: string;
  handles: EditHandle[];
  /** Why its points can't be dragged, when they can't. */
  note: string | null;
};

/**
 * Transforms that leave the shape's own points where they are (they add to
 * it, or work on its outline): its points can still be dragged.
 */
const IN_PLACE = new Set([
  'tabs',
  'dogbone',
  'corners',
  'offset',
  'simplify',
  'convexhull',
  'bounds',
  'centers',
  // Copies: the first is where the shape is.
  'repeat',
  'polar',
]);

/**
 * The shape open in the editor, the one the preview edits: the expanded
 * one, while no operation is (the preview then shows those).
 */
export function selectedShapeId(model: ModelType): string | null {
  const operationOpen = (model.operations ?? []).some(
    (o: any) =>
      o?.expanded || (o?.operations ?? []).some((i: any) => i?.expanded),
  );
  if (operationOpen) {
    return null;
  }
  return (model.shapes ?? []).find((s: any) => s?.expanded)?.id ?? null;
}

/**
 * The selected shape's draggable points, from the model (`raw`, as stored:
 * expressions lock a point) and the same model with the expressions worked
 * out (`resolved`: where the points are).
 */
export function shapeEditing(
  raw: ModelType,
  resolved: ModelType,
): ShapeEditing | null {
  const shapeId = selectedShapeId(raw);
  const shape: any = resolved.shapes?.find((s: any) => s.id === shapeId);
  const rawShape: any = raw.shapes?.find((s: any) => s.id === shapeId);
  if (!shapeId || !shape || !rawShape) {
    return null;
  }
  const editable =
    shape.type === 'polyline' ||
    shape.type === 'path-data' ||
    (shape.type === 'points' && (shape.pointsMode ?? 'list') === 'list');
  if (!editable) {
    return { shapeId, handles: [], note: null };
  }

  // Its moves add up; other transforms that move it hide where its points
  // end up.
  let offset = { x: 0, y: 0 };
  for (const t of shape.transforms ?? []) {
    if (t.disabled) continue;
    if (t.type === 'translate') {
      offset = {
        x: offset.x + (finite(t.translateX) ?? 0),
        y: offset.y + (finite(t.translateY) ?? 0),
      };
    } else if (!IN_PLACE.has(t.type)) {
      return {
        shapeId,
        handles: [],
        note: 'its points can be dragged while its transforms only move it',
      };
    }
  }

  const rawItem = (list: string, id: string) =>
    (rawShape[list] ?? []).find((item: any) => item?.id === id) ?? {};
  const lockedIn = (item: any, ...keys: Array<string | null>) =>
    keys.some((k) => k !== null && typeof item[k] !== 'number');

  if (shape.type !== 'path-data') {
    const list = shape.type === 'polyline' ? 'polylinePoints' : 'pointsList';
    const handles = (shape[list] ?? []).flatMap((item: any): EditHandle[] => {
      const x = finite(item?.x);
      const y = finite(item?.y);
      if (x === null || y === null) return [];
      return [
        {
          x: x + offset.x,
          y: y + offset.y,
          control: false,
          locked: lockedIn(rawItem(list, item.id), 'x', 'y'),
          list,
          itemId: item.id,
          xKey: 'x',
          yKey: 'y',
          base: offset,
        },
      ];
    });
    return { shapeId, handles, note: null };
  }

  // Path data: walk the commands, keeping the current point (and where the
  // subpath started), as the path is drawn. Stops where a number can't be
  // worked out, like the path itself.
  const handles: EditHandle[] = [];
  let at = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  for (const command of shape.pathCommands ?? []) {
    const letter: string = command?.command ?? '';
    const upper = letter.toUpperCase();
    if (upper === 'Z') {
      at = start;
      continue;
    }
    const relative = letter !== upper;
    const from = relative ? at : { x: 0, y: 0 };
    const base = { x: from.x + offset.x, y: from.y + offset.y };
    const item = rawItem('pathCommands', command.id);
    const value = (key: string) => finite(command[key]);
    const pair = (xKey: string, yKey: string, control: boolean) => {
      const x = value(xKey);
      const y = value(yKey);
      if (x === null || y === null) return null;
      handles.push({
        x: base.x + x,
        y: base.y + y,
        control,
        locked: lockedIn(item, xKey, yKey),
        list: 'pathCommands',
        itemId: command.id,
        xKey,
        yKey,
        base,
      });
      return { x: from.x + x, y: from.y + y };
    };
    let end: CamPoint | null = null;
    if (upper === 'H' || upper === 'V') {
      const key = upper === 'H' ? 'x' : 'y';
      const v = value(key);
      if (v === null) break;
      end =
        upper === 'H' ? { x: from.x + v, y: at.y } : { x: at.x, y: from.y + v };
      handles.push({
        x: end.x + offset.x,
        y: end.y + offset.y,
        control: false,
        locked: lockedIn(item, key),
        list: 'pathCommands',
        itemId: command.id,
        xKey: upper === 'H' ? 'x' : null,
        yKey: upper === 'V' ? 'y' : null,
        base,
      });
    } else {
      if (upper === 'C' || upper === 'Q') {
        if (!pair('x1', 'y1', true)) break;
      }
      if (upper === 'C' || upper === 'S') {
        if (!pair('x2', 'y2', true)) break;
      }
      end = pair('x', 'y', false);
      if (!end) break;
    }
    at = end;
    if (upper === 'M') start = end;
  }
  return { shapeId, handles, note: null };
}

/**
 * The model with shape `shapeId` open in the editor (null: none), the rest
 * closed, and no operation open (so the preview shows the shape).
 */
export function selectShape(
  model: ModelType,
  shapeId: string | null,
): ModelType {
  return {
    ...model,
    shapes: (model.shapes ?? []).map((s: any) =>
      !!s.expanded === (s.id === shapeId)
        ? s
        : { ...s, expanded: s.id === shapeId },
    ),
    operations: shapeId
      ? (model.operations ?? []).map((o: any) => closeOperation(o))
      : model.operations,
  };
}

function closeOperation(o: any): any {
  const inner = o?.operations;
  const open = o?.expanded || (inner ?? []).some((i: any) => i?.expanded);
  if (!open) return o;
  return {
    ...o,
    expanded: false,
    ...(inner ? { operations: inner.map((i: any) => closeOperation(i)) } : {}),
  };
}

/** To a hundredth of a millimetre. */
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The model with shape `shapeId` moved by (`dx`, `dy`): its last transform
 * changed when that's a plain move, otherwise a move added after the rest.
 */
export function moveShape(
  model: ModelType,
  shapeId: string,
  dx: number,
  dy: number,
  newId: string,
): ModelType {
  return mapShape(model, shapeId, (shape) => {
    const transforms: any[] = [...(shape.transforms ?? [])];
    const last = transforms[transforms.length - 1];
    if (
      last?.type === 'translate' &&
      !last.disabled &&
      typeof last.translateX === 'number' &&
      typeof last.translateY === 'number'
    ) {
      transforms[transforms.length - 1] = {
        ...last,
        translateX: round(last.translateX + dx),
        translateY: round(last.translateY + dy),
      };
    } else {
      transforms.push({
        id: newId,
        disabled: false,
        expanded: false,
        type: 'translate',
        translateX: round(dx),
        translateY: round(dy),
      });
    }
    return { ...shape, transforms };
  });
}

/** The model with the point `handle` stands for dragged to `to`. */
export function movePoint(
  model: ModelType,
  shapeId: string,
  handle: EditHandle,
  to: CamPoint,
): ModelType {
  if (handle.locked) {
    return model;
  }
  return mapShape(model, shapeId, (shape) => ({
    ...shape,
    [handle.list]: (shape[handle.list] ?? []).map((item: any) =>
      item?.id !== handle.itemId
        ? item
        : {
            ...item,
            ...(handle.xKey
              ? { [handle.xKey]: round(to.x - handle.base.x) }
              : {}),
            ...(handle.yKey
              ? { [handle.yKey]: round(to.y - handle.base.y) }
              : {}),
          },
    ),
  }));
}

function mapShape(
  model: ModelType,
  shapeId: string,
  change: (shape: any) => any,
): ModelType {
  return {
    ...model,
    shapes: (model.shapes ?? []).map((s: any) =>
      s.id === shapeId ? change(s) : s,
    ),
  };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
