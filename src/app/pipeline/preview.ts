import {
  combineLatest,
  distinctUntilChanged,
  map,
  MonoTypeOperatorFunction,
  Observable,
  of,
  scan,
} from 'rxjs';
import { CamPath, CamPoint3, Highlight } from '../../cam/types';
import { ModelType } from '../model-editor/model';
import { distinctItems, distinctJson } from './operators';
import { borrowedShapeId } from '../model-editor/operations/describe';
import {
  flatOperations,
  NO_TOOL,
  ROTARY_REPEAT,
} from '../model-editor/operations/flatten';

/**
 * The model as the preview sees it: items of a collapsed editor section
 * (`collapsedSections$`: `shapes`, `operations`) count as closed, since
 * they can't be seen being edited.
 */
function openInEditor(
  model$: Observable<ModelType>,
  collapsedSections$: Observable<string[]>,
): Observable<Pick<ModelType, 'shapes' | 'operations'>> {
  return combineLatest([model$, collapsedSections$]).pipe(
    map(([{ shapes, operations }, collapsed]) => ({
      shapes: collapsed.includes('shapes')
        ? shapes.map((s) => ({ ...s, expanded: false }))
        : shapes,
      operations: collapsed.includes('operations')
        ? (operations ?? []).map((o) => ({ ...o, expanded: false }))
        : operations,
    })),
  );
}

/**
 * Shapes toggled off in the editor (hidden in the preview only), unless
 * they're expanded: a shape being edited is shown.
 */
export function hiddenShapeIds(
  model$: Observable<ModelType>,
  collapsedSections$: Observable<string[]> = of([]),
): Observable<string[]> {
  return openInEditor(model$, collapsedSections$).pipe(
    map(({ shapes }) =>
      shapes.filter((s) => s.hidden && !s.expanded).map((s) => s.id),
    ),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );
}

/**
 * An expanded operation highlights its toolpaths and the shape it cuts (a
 * rotate step, those of the operations it turns the stock for; a rotary
 * repeat, those of its operations, or of those open in it); otherwise an expanded shape highlights itself and its toolpaths. Nothing
 * expanded (or only in collapsed sections) highlights everything.
 */
export function highlightFromModel(
  model$: Observable<ModelType>,
  collapsedSections$: Observable<string[]> = of([]),
): Observable<Highlight> {
  return openInEditor(model$, collapsedSections$).pipe(
    map(({ shapes, operations }) => {
      const expandedOperations = (operations ?? []).flatMap((o: any, i) => {
        if (!o.expanded) return [];
        if (o.type === 'rotate') return turnedBy(i, operations);
        if (o.type === ROTARY_REPEAT) {
          // Those open inside it, or all of them.
          const inner: any[] = o.operations ?? [];
          const open = inner.filter((x) => x.expanded);
          return open.length ? open : inner;
        }
        return [o];
      });
      if (expandedOperations.length) {
        const shapeIds = expandedOperations.flatMap((operation) => {
          const effective = borrowedShapeId(
            operation,
            flatOperations(operations),
          );
          return effective ? [effective] : [];
        });
        return {
          shapes: [...new Set(shapeIds)],
          operations: expandedOperations.map((o) => o.id),
        };
      }
      return {
        shapes: [...new Set(shapes.filter((s) => s.expanded).map((s) => s.id))],
        operations: [],
      };
    }),
    distinctJson(),
  );
}

/** The operations the rotate step at `index` turns the stock for. */
function turnedBy(
  index: number,
  operations: ModelType['operations'],
): ModelType['operations'] {
  const below = operations.slice(index + 1);
  const next = below.findIndex((o) => o.type === 'rotate' && !o.disabled);
  // Rotary repeats turn the stock for themselves.
  return (next < 0 ? below : below.slice(0, next)).filter(
    (o) => !NO_TOOL.has(o.type!),
  );
}

/**
 * Hands back the previous emission's path object for every path that hasn't
 * changed, so the viewer (which matches paths by identity) keeps its meshes
 * and only redraws what an edit actually changed.
 *
 * Paths are matched by operation, type, shape and their position among
 * those, so re-routing one operation doesn't shift the others' matches.
 */
export function reuseUnchangedPaths(): MonoTypeOperatorFunction<CamPath[]> {
  return (paths$) =>
    paths$.pipe(
      scan(
        ({ byKey: previous }, paths) => {
          const byKey = new Map<string, CamPath>();
          const seen = new Map<string, number>();
          const result = paths.map((path) => {
            const group = `${path.sourceOperationId ?? ''}|${path.type}|${path.sourceShapeId}`;
            const n = seen.get(group) ?? 0;
            seen.set(group, n + 1);
            const key = `${group}|${n}`;
            const old = previous.get(key);
            const kept =
              old &&
              old.rotation === path.rotation &&
              old.wrapped === path.wrapped &&
              samePoints(old.points, path.points) &&
              sameFeeds(old.feeds, path.feeds)
                ? old
                : path;
            byKey.set(key, kept);
            return kept;
          });
          return { byKey, paths: result };
        },
        { byKey: new Map<string, CamPath>(), paths: [] as CamPath[] },
      ),
      map(({ paths }) => paths),
      distinctItems(),
    );
}

function samePoints(a: CamPoint3[], b: CamPoint3[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].z !== b[i].z) {
      return false;
    }
  }
  return true;
}

function sameFeeds(a: number[] | undefined, b: number[] | undefined) {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((feed, i) => feed === b[i]);
}
