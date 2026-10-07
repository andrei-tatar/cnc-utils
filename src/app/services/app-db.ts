/**
 * The app's own IndexedDB database: the open project, the projects saved by
 * name, and the tool library shared by all projects.
 */

const DB_NAME = 'cnc-utils';
const VERSION = 3;
export const PROJECT_STORE = 'project';
export const TOOLS_STORE = 'tools';
/** The saved projects' names and times (listed without their models). */
export const PROJECTS_STORE = 'projects';
/** The saved projects' models, by project id. */
export const PROJECT_MODELS_STORE = 'projectModels';
/** Some browsers never answer an open; carry on without the database. */
const OPEN_TIMEOUT = 3000;

let database: Promise<IDBDatabase | null> | null = null;
let opened: IDBDatabase | null = null;

/** The database, or null where IndexedDB can't be used. */
export function openAppDb(): Promise<IDBDatabase | null> {
  if (!database) {
    database = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT);
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of [
          PROJECT_STORE,
          TOOLS_STORE,
          PROJECTS_STORE,
          PROJECT_MODELS_STORE,
        ]) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        // A newer version of the app (another tab) needs to upgrade it:
        // step aside, and open it again when next needed.
        db.onversionchange = () => {
          db.close();
          opened = null;
          database = null;
        };
        opened = db;
        resolve(db);
      };
      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      // Blocked by another tab: wait for it to close (or the timeout).
    });
  }
  return database;
}

/**
 * The database if it's already open, for work that must start right away
 * (saving as the page closes can't wait for anything).
 */
export function openedAppDb(): IDBDatabase | null {
  return opened;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
