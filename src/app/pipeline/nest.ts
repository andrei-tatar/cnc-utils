import {
  Box,
  nestRectangles,
  NestResult,
  placeShapes,
  shapesBox,
} from '../../cam/sheet-nesting';
import { CamShape } from '../../cam/types';
import type { ModelType as NestParameters } from '../model-editor/shapes/shape-nest';
import type { NestLayerItem } from '../model-editor/shapes/shape-nest-layer';

/** How a nest's parts are laid out, with each part's box. */
export type NestLayout = {
  result: NestResult;
  /** By item (null for a part with nothing in it). */
  boxes: (Box | null)[];
};

/** Lays out a nest's parts (`itemShapes`: each item's shape, in order). */
export function nestLayout(
  t: Pick<
    NestParameters,
    | 'nestItems'
    | 'nestSheetWidth'
    | 'nestSheetHeight'
    | 'nestMargin'
    | 'nestGap'
  >,
  itemShapes: CamShape[][],
): NestLayout {
  const items = t.nestItems ?? [];
  const boxes = itemShapes.map(shapesBox);
  const result = nestRectangles(
    items.flatMap((item, i) => {
      const box = boxes[i];
      return box
        ? [
            {
              key: String(i),
              width: box.maxX - box.minX,
              height: box.maxY - box.minY,
              count: item?.count ?? 0,
              rotate: !!item?.rotate,
            },
          ]
        : [];
    }),
    {
      width: t.nestSheetWidth ?? 0,
      height: t.nestSheetHeight ?? 0,
      margin: t.nestMargin ?? 0,
      gap: t.nestGap ?? 0,
    },
  );
  return { result, boxes };
}

/** The sheet (from 0) a nest shows. */
export function nestSheetIndex(t: Pick<NestParameters, 'nestSheet'>): number {
  return Math.max(0, Math.round((t.nestSheet ?? 1) - 1));
}

/** A nest's parts on the sheet it shows, as one shape. */
export function nestShapes(
  t: NestParameters,
  itemShapes: CamShape[][],
  shapeId: string,
): CamShape[] {
  const { result, boxes } = nestLayout(t, itemShapes);
  const sheet = nestSheetIndex(t);
  return mergeShapes(
    result.placements
      .filter((p) => p.sheet === sheet)
      .flatMap((p) => {
        const i = Number(p.key);
        return placeShapes(
          itemShapes[i],
          boxes[i]!,
          p.rotated,
          { x: p.x, y: p.y },
          shapeId,
        );
      }),
    shapeId,
  );
}

/**
 * The shapes that go with a nest's parts, each placed wherever its part is
 * on the sheet the nest shows. `layerShapes` are `layers`' shapes, in order.
 */
export function nestLayerShapes(
  nest: NestParameters,
  itemShapes: CamShape[][],
  layers: NestLayerItem[],
  layerShapes: CamShape[][],
  shapeId: string,
): CamShape[] {
  const { result, boxes } = nestLayout(nest, itemShapes);
  const sheet = nestSheetIndex(nest);
  const items = nest.nestItems ?? [];
  return mergeShapes(
    result.placements
      .filter((p) => p.sheet === sheet)
      .flatMap((p) => {
        const i = Number(p.key);
        return layers.flatMap((layer, k) =>
          layer?.partShapeId === items[i]?.shapeId
            ? placeShapes(
                layerShapes[k],
                boxes[i]!,
                p.rotated,
                { x: p.x, y: p.y },
                shapeId,
              )
            : [],
        );
      }),
    shapeId,
  );
}

/** Shapes as one: their polygons and tabs together. */
function mergeShapes(shapes: CamShape[], shapeId: string): CamShape[] {
  if (!shapes.length) return [];
  const tabs = shapes.flatMap((s) => s.tabs ?? []);
  const merged: CamShape = {
    sourceShapeId: shapeId,
    polygons: shapes.flatMap((s) => s.polygons),
  };
  if (tabs.length) merged.tabs = tabs;
  return [merged];
}
