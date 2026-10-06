import { distinctUntilChanged, map, Observable } from 'rxjs';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { GeometrySettings } from '../../cam/geometry';
import { deepEqual } from '../../util';
import { ModelType } from '../model-editor/model';
import { shareLatest } from './operators';

/**
 * The geometry settings from the G-code section; shapes and toolpaths are
 * regenerated when they change.
 */
export function geometrySettings(
  model$: Observable<ModelType>,
): Observable<GeometrySettings> {
  return model$.pipe(
    map(({ gcode }) => {
      const options = resolveGcodeOptions(gcode);
      return {
        curveTolerance: options.curveTolerance,
        decimals: options.geometryDecimals,
      };
    }),
    distinctUntilChanged((a, b) => deepEqual(a, b)),
    shareLatest(),
  );
}
