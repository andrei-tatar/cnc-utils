import {
  distinctUntilChanged,
  map,
  MonoTypeOperatorFunction,
  Observable,
  scan,
} from 'rxjs';
import { CamPath, CamPoint3, Highlight } from '../../cam/types';
import { ModelType } from '../model-editor/model';
import { distinctItems, distinctJson } from './operators';
import { borrowedShapeId } from '../model-editor/operations/describe';

/**
 * Shapes toggled off in the editor (hidden in the preview only), unless
 * they're expanded: a shape being edited is shown.
 */
export function hiddenShapeIds(
  model$: Observable<ModelType>,
): Observable<string[]> {
  return model$.pipe(
    map(({ shapes }) =>
      shapes.filter((s) => s.hidden && !s.expanded).map((s) => s.id),
    ),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );
}

/**
 * An expanded operation highlights its toolpaths and the shape it cuts;
 * otherwise an expanded shape highlights itself and its toolpaths.
 */
export function highlightFromModel(
  model$: Observable<ModelType>,
): Observable<Highlight> {
  return model$.pipe(
    map(({ shapes, operations }) => {
      const expandedOperations = (operations ?? []).filter((o) => o.expanded);
      if (expandedOperations.length) {
        const shapeIds = expandedOperations.flatMap((operation) => {
          const effective = borrowedShapeId(operation, operations);
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
