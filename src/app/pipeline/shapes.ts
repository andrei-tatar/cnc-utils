import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  race,
  ReplaySubject,
  scan,
  share,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { CamShape } from '../../cam/types';
import { GeometrySettings } from '../../cam/geometry';
import worker from '../../worker';
import { deepEqual } from '../../util';
import {
  ModelType,
  ShapeParameters,
  ShapeType,
  TransformParameters,
} from '../model-editor/model';
import { createSvgFromShape } from './shape-svg';
import { geometrySettings } from './geometry-settings';
import { distinctJson, shareLatest } from './operators';

/** A long-lived pipeline for one shape, kept across model emissions. */
type ShapeEntry = {
  shapeId: string;
  shapeParameters$: BehaviorSubject<ShapeParameters>;
  shapeTransforms$: BehaviorSubject<ShapeType['transforms']>;
  result$: Observable<CamShape[]>;
};

/** A long-lived pipeline for one transform of a shape. */
type TransformEntry = {
  transformId: string;
  transformParameters$: BehaviorSubject<TransformParameters>;
  input: Subject<CamShape[]>;
  output$: Observable<CamShape[]>;
};

/**
 * Turns the model's shapes into polygons, all shapes' flattened together.
 *
 * Each shape keeps its pipeline across model emissions (its inputs are
 * pushed into it), so a shape is only regenerated when its own parameters,
 * transforms or the geometry settings change.
 */
export function generateShapesFromModel(
  model$: Observable<ModelType>,
  working$: Observable<never>,
): Observable<CamShape[]> {
  const geometry$ = geometrySettings(model$);
  const entries$: Observable<ShapeEntry[]> = model$.pipe(
    scan(
      (ctx, { shapes }) =>
        shapes.map(
          ({
            id: shapeId,
            transforms: shapeTransforms,
            expanded: _,
            name: __,
            hidden: ___,
            ...shapeParameters
          }) => {
            const existing = ctx.find((e) => e.shapeId === shapeId);
            if (existing) {
              existing.shapeParameters$.next(shapeParameters);
              existing.shapeTransforms$.next(shapeTransforms);
              return existing;
            }
            return createShapeEntry(
              shapeId,
              shapeParameters,
              shapeTransforms,
              entries$,
              geometry$,
              working$,
            );
          },
        ),
      [] as ShapeEntry[],
    ),
    share({
      connector: () => new ReplaySubject(1),
    }),
  );

  return entries$.pipe(
    // With no shapes, emit an empty list rather than nothing.
    switchMap((s) =>
      s.length ? combineLatest(s.map((i) => i.result$)) : of([]),
    ),
    map((s) => s.flatMap((i) => i)),
    share({
      connector: () => new ReplaySubject(1),
    }),
  );
}

function createShapeEntry(
  shapeId: string,
  shapeParameters: ShapeParameters,
  shapeTransforms: ShapeType['transforms'],
  entries$: Observable<ShapeEntry[]>,
  geometry$: Observable<GeometrySettings>,
  working$: Observable<never>,
): ShapeEntry {
  const shapeParameters$ = new BehaviorSubject(shapeParameters);
  const shapeTransforms$ = new BehaviorSubject(shapeTransforms);

  const shape$ = combineLatest([
    shapeParameters$.pipe(distinctUntilChanged((a, b) => deepEqual(a, b))),
    geometry$,
  ]).pipe(
    map(([t, geometry]) => resolveShape(t, shapeId, geometry, entries$)),
    switchMap((resolveShape) => race(resolveShape, working$)),
    shareLatest(),
  );

  const result$ = applyTransforms(shape$, shapeTransforms$, working$);

  return { shapeId, result$, shapeParameters$, shapeTransforms$ };
}

/** The shape's polygons, before its transforms. */
function resolveShape(
  t: ShapeParameters,
  shapeId: string,
  geometry: GeometrySettings,
  entries$: Observable<ShapeEntry[]>,
): Observable<CamShape[]> {
  switch (t.type) {
    case 'boolean':
      return combineLatest([
        resultOf(entries$, t.shape1Id),
        resultOf(entries$, t.shape2Id),
      ]).pipe(
        debounceTime(0),
        switchMap(([s1, s2]) => {
          if (!t.operationType || !t.fillRule) {
            return [];
          }

          return worker.applyBooleanOperation(
            s1,
            s2,
            t.operationType,
            t.fillRule,
            shapeId,
            geometry,
          );
        }),
      );

    case 'copy':
      // Another shape's result, as this shape's (so the transforms and
      // operations work on it).
      return resultOf(entries$, t.copyOfId).pipe(
        map((source) => source.map((s) => ({ ...s, sourceShapeId: shapeId }))),
      );

    case 'text':
      return worker.importText(t, shapeId, geometry);

    default:
      return worker.importSvg(createSvgFromShape(t), shapeId, geometry);
  }
}

/** Another shape's result (with its transforms applied). */
function resultOf(
  entries$: Observable<ShapeEntry[]>,
  shapeId: string,
): Observable<CamShape[]> {
  return entries$.pipe(
    switchMap(
      (s) =>
        s.find((v) => v.shapeId === shapeId)?.result$ ??
        // Deleted or unset shape: treat as empty instead of waiting forever
        // (which stalls every shape).
        of([] as CamShape[]),
    ),
    distinctUntilChanged(),
  );
}

/**
 * Chains the shape's transforms: each one's output feeds the next one's
 * input. Like shapes, transforms keep their pipeline across emissions, so
 * editing one only re-runs it and the ones after it.
 */
function applyTransforms(
  shape$: Observable<CamShape[]>,
  shapeTransforms$: Observable<ShapeType['transforms']>,
  working$: Observable<never>,
): Observable<CamShape[]> {
  const transforms$ = shapeTransforms$.pipe(
    scan(
      (ctx, transforms) =>
        transforms.map(
          ({ id: transformId, expanded: _, ...transformParams }) => {
            const existing = ctx.find((t) => t.transformId === transformId);
            if (existing) {
              existing.transformParameters$.next(transformParams);
              return existing;
            }
            return createTransformEntry(transformId, transformParams, working$);
          },
        ),
      [] as TransformEntry[],
    ),
  );

  return transforms$.pipe(
    switchMap((all) => {
      let input$ = shape$;

      const watch: Observable<never>[] = [];
      for (let i = 0; i < all.length; i++) {
        watch.push(
          input$.pipe(
            tap((v) => all[i].input.next(v)),
            ignoreElements(),
          ),
        );
        input$ = all[i].output$;
      }
      return merge(input$, ...watch);
    }),
    shareLatest(),
  );
}

function createTransformEntry(
  transformId: string,
  transformParameters: TransformParameters,
  working$: Observable<never>,
): TransformEntry {
  const transformParameters$ = new BehaviorSubject(transformParameters);
  const input = new Subject<CamShape[]>();

  const output$ = transformParameters$.pipe(
    distinctJson(),
    switchMap((transform) =>
      input.pipe(
        distinctUntilChanged(),
        switchMap((shape) =>
          race(worker.applyTransform(shape, transform), working$),
        ),
      ),
    ),
    shareLatest(),
  );

  return { transformId, transformParameters$, input, output$ };
}
