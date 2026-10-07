import { migrateModel, ModelType } from '../model-editor/model';
import {
  openAppDb,
  openedAppDb,
  PROJECT_STORE,
  requestResult,
  transactionDone,
} from './app-db';

/**
 * Where the project is kept between visits: IndexedDB, which holds large
 * imported files (SVG, images) that would overflow localStorage's few
 * megabytes, and stores the model as is instead of as one big JSON string.
 * When IndexedDB can't be used it falls back to localStorage; each copy
 * carries the time it was saved, and the newer one is loaded. Projects
 * saved by older versions (in localStorage, no time) are still read, and
 * moved over on the next save.
 */

const LEGACY_KEY = 'model';
const LEGACY_SAVED_AT_KEY = 'modelSavedAt';
const MODEL_KEY = 'model';

/**
 * The project as stored in IndexedDB, with the saved project (`projects/`)
 * it was opened from or saved as, if any.
 */
type Saved = { model: unknown; savedAt: number; projectId?: string };

let preloaded: Saved | null = null;

/** Read the saved project before the app starts (it's needed right away). */
export async function preloadModel(): Promise<void> {
  try {
    const db = await openAppDb();
    if (!db) return;
    const value = await requestResult(
      db.transaction(PROJECT_STORE).objectStore(PROJECT_STORE).get(MODEL_KEY),
    );
    if (value !== undefined) {
      // Saved before copies carried a time: older than anything that does.
      preloaded = isSaved(value) ? value : { model: value, savedAt: 0 };
    }
  } catch {
    preloaded = null;
  }
}

/** The saved project (migrated), or an empty one. */
export function loadModel(): ModelType {
  const legacy = readLegacy();
  const newest =
    preloaded && (!legacy || preloaded.savedAt >= legacy.savedAt)
      ? preloaded
      : legacy;
  return migrateModel(newest?.model ?? {});
}

/**
 * The id of the saved project the loaded one belongs to, or null (also when
 * the newer copy is the localStorage one, which doesn't keep it).
 */
export function loadProjectId(): string | null {
  const legacy = readLegacy();
  return preloaded && (!legacy || preloaded.savedAt >= legacy.savedAt)
    ? (preloaded.projectId ?? null)
    : null;
}

/** Saves the project; starts at once if the database is already open. */
export async function saveModel(model: ModelType, projectId: string | null) {
  const saved: Saved = {
    model,
    savedAt: Date.now(),
    ...(projectId ? { projectId } : {}),
  };
  const db = openedAppDb() ?? (await openAppDb());
  if (db) {
    try {
      const tx = db.transaction(PROJECT_STORE, 'readwrite');
      tx.objectStore(PROJECT_STORE).put(saved, MODEL_KEY);
      tx.commit?.();
      await transactionDone(tx);
      // Saved where it fits: free the old copy's space.
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LEGACY_SAVED_AT_KEY);
      return;
    } catch (error) {
      console.warn('[model] could not save to IndexedDB', error);
    }
  }
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(model));
    localStorage.setItem(LEGACY_SAVED_AT_KEY, String(saved.savedAt));
  } catch (error) {
    console.error('[model] could not save the project', error);
  }
}

function readLegacy(): Saved | null {
  try {
    const text = localStorage.getItem(LEGACY_KEY);
    if (!text) return null;
    return {
      model: JSON.parse(text),
      savedAt: Number(localStorage.getItem(LEGACY_SAVED_AT_KEY)) || -1,
    };
  } catch {
    return null;
  }
}

function isSaved(value: unknown): value is Saved {
  return (
    typeof value === 'object' &&
    value !== null &&
    'model' in value &&
    typeof (value as Saved).savedAt === 'number'
  );
}
