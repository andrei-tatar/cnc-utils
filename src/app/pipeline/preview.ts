import { distinctUntilChanged, map, Observable } from 'rxjs';
import { Highlight } from '../../cam/types';
import { ModelType } from '../model-editor/model';
import { distinctJson } from './operators';
import { vCarveSource } from './vcarve-source';

/** Shapes toggled off in the editor (hidden in the preview only). */
export function hiddenShapeIds(
  model$: Observable<ModelType>,
): Observable<string[]> {
  return model$.pipe(
    map(({ shapes }) => shapes.filter((s) => s.hidden).map((s) => s.id)),
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
    map(({ shapes, tools, operations }) => {
      const expandedOperations = (operations ?? []).filter((o) => o.expanded);
      if (expandedOperations.length) {
        const shapeIds = expandedOperations.flatMap(
          ({ id, expanded, name, shapeId, toolId, ...parameters }) => {
            const source = vCarveSource(parameters, operations, tools);
            const effective = source ? source.shapeId : shapeId;
            return effective ? [effective] : [];
          },
        );
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
