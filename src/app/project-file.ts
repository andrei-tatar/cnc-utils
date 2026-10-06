import { EMPTY, Observable, switchMap } from 'rxjs';
import { readFile } from '../util';
import { migrateModel, ModelType } from './model-editor/model';
import { loadModelFromMetadata } from './store';

const MODEL_PREFIX = '; model=';

/** Saves `data` as a file through the browser's download. */
export function downloadFile(data: string, fileName: string) {
  const a = document.createElement('a');
  a.setAttribute('style', 'display: none');
  document.body.appendChild(a);

  const url = window.URL.createObjectURL(
    new Blob([data], { type: 'octet/stream' }),
  );
  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

/**
 * Asks for a G-code file and emits the project embedded in it (migrated to
 * the current model). Completes without emitting for a file without one.
 */
export function readModelFromNcFile(): Observable<ModelType> {
  return readFile().pipe(
    switchMap((file) => file.text()),
    switchMap((content) => {
      const foundLine = content
        .split('\n')
        .find((l) => l.startsWith(MODEL_PREFIX));

      if (foundLine) {
        return loadModelFromMetadata(
          foundLine.substring(MODEL_PREFIX.length),
        ).then(migrateModel);
      }

      return EMPTY;
    }),
  );
}
