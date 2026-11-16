import { EMPTY, map, Observable, of, switchMap } from 'rxjs';
import { readFile } from '../util';
import { ModelType } from './model-editor/model';
import { migrateModel } from './model-editor/migrations';
import { loadModelFromGcode } from './store';

/** Saves `data` as a file through the browser's download. */
export function downloadFile(
  data: string | Blob,
  fileName: string,
  type = 'octet/stream',
) {
  const a = document.createElement('a');
  a.setAttribute('style', 'display: none');
  document.body.appendChild(a);

  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

/**
 * `name` made safe for a file name: runs of anything but letters, digits,
 * `.`, `_` and `-` become `-`. Empty when nothing of it is left.
 */
export function fileNameFrom(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
}

/**
 * The project embedded in a G-code file's text. Throws, saying why, when
 * it has none or it can't be read.
 */
export async function modelFromNcText(content: string): Promise<ModelType> {
  let stored: unknown;
  try {
    stored = await loadModelFromGcode(content);
  } catch {
    throw new Error('the project in it can’t be read (the file is damaged)');
  }
  if (!stored) {
    throw new Error(
      'there’s no project in it (G-code downloaded from this app has one)',
    );
  }
  return migrateModel(stored);
}

/** What a file dropped on the app is, by its name (or type). */
export function droppedFileKind(file: {
  name: string;
  type?: string;
}): 'svg' | 'model' | 'project' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.svg') || file.type === 'image/svg+xml') return 'svg';
  if (/\.(stl|3mf)$/.test(name)) return 'model';
  return /\.(nc|ngc|gcode)$/.test(name) ? 'project' : null;
}

/** Whether `text` is an SVG document. */
export function isSvg(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  return (
    doc.documentElement?.localName === 'svg' &&
    !doc.getElementsByTagName('parsererror').length
  );
}

/** A file's content as a data URL. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Asks for a G-code file and emits the project embedded in it. Completes
 * without emitting for a file without one.
 */
export function readModelFromNcFile(): Observable<ModelType> {
  return readFile().pipe(
    switchMap((file) => file.text()),
    switchMap((content) => loadModelFromGcode(content)),
    switchMap((stored) => (stored ? of(stored) : EMPTY)),
    map(migrateModel),
  );
}
