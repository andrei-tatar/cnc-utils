import {
  openAppDb,
  PROJECT_MODELS_STORE,
  PROJECTS_STORE,
  requestResult,
  transactionDone,
} from '../services/app-db';
import type { ModelType } from '../model-editor/model';

/**
 * Projects the user saved by name, kept in this browser (the app database).
 * A project's name and time are stored apart from its model, so the list
 * can be read without loading every project's imported files.
 */
export type Project = {
  id: string;
  name: string;
  savedAt: number;
};

/** The saved projects, most recently saved first. */
export async function listProjects(): Promise<Project[]> {
  const db = await openAppDb();
  if (!db) return [];
  const projects = (await requestResult(
    db.transaction(PROJECTS_STORE).objectStore(PROJECTS_STORE).getAll(),
  )) as Project[];
  return projects.sort((a, b) => b.savedAt - a.savedAt);
}

/** A saved project's name and time; null when there's no such project. */
export async function getProject(id: string): Promise<Project | null> {
  const db = await openAppDb();
  if (!db) return null;
  const project = await requestResult(
    db.transaction(PROJECTS_STORE).objectStore(PROJECTS_STORE).get(id),
  );
  return (project as Project | undefined) ?? null;
}

/**
 * A saved project's model, as stored (not migrated); undefined when there's
 * no such project.
 */
export async function loadProject(id: string): Promise<unknown> {
  const db = await openAppDb();
  if (!db) return undefined;
  return requestResult(
    db
      .transaction(PROJECT_MODELS_STORE)
      .objectStore(PROJECT_MODELS_STORE)
      .get(id),
  );
}

/** Saves (or replaces) a project and its model. */
export async function putProject(project: Project, model: ModelType) {
  const db = await openAppDb();
  if (!db) {
    throw new Error('Projects can’t be stored in this browser.');
  }
  const tx = db.transaction(
    [PROJECTS_STORE, PROJECT_MODELS_STORE],
    'readwrite',
  );
  tx.objectStore(PROJECTS_STORE).put(project, project.id);
  tx.objectStore(PROJECT_MODELS_STORE).put(model, project.id);
  await transactionDone(tx);
}

export async function deleteProject(id: string) {
  const db = await openAppDb();
  if (!db) return;
  const tx = db.transaction(
    [PROJECTS_STORE, PROJECT_MODELS_STORE],
    'readwrite',
  );
  tx.objectStore(PROJECTS_STORE).delete(id);
  tx.objectStore(PROJECT_MODELS_STORE).delete(id);
  await transactionDone(tx);
}
