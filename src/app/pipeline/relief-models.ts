import { combineLatest, map, Observable, of, switchMap } from 'rxjs';
import { ModelType } from '../model-editor/model';
import { distinctJson, shareLatest } from './operators';
import { ShapeResults } from './shapes';

/** A 3D model shape, for the preview to show where it is. */
export type PreviewModel = {
  shapeId: string;
  /**
   * Its triangles (nine numbers each: three corners' x, y, z) in design
   * coordinates, like the outlines (on a rotary axis, on the blank at 0°).
   */
  triangles: Float32Array;
};

/** The meshes of the 3D model shapes that aren't hidden. */
export function shapeModels(
  model$: Observable<ModelType>,
  shapes: ShapeResults,
): Observable<PreviewModel[]> {
  return model$.pipe(
    map((model) =>
      (model.shapes ?? [])
        .filter((shape) => shape.type === 'model' && !shape.hidden)
        .map((shape) => shape.id),
    ),
    distinctJson(),
    switchMap((ids) =>
      ids.length
        ? combineLatest(
            ids.map((shapeId) =>
              shapes
                .meshById(shapeId)
                .pipe(
                  map((triangles) =>
                    triangles ? { shapeId, triangles } : null,
                  ),
                ),
            ),
          )
        : of([]),
    ),
    map((models) => models.filter((m): m is PreviewModel => !!m)),
    shareLatest(),
  );
}
