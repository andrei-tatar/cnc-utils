import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type { Auth, User } from 'firebase/auth';
import type { Database } from 'firebase/database';
import type { ModelType } from '../model-editor/model';
import { LibraryEntry, sortedByName } from '../model-editor/tools/tool-library';
import { migrateModel } from '../model-editor/migrations';
import { reportError } from '../pipeline/errors';
import { getModelMetadata, loadModelFromMetadata } from '../store';
import { FIREBASE_CONFIG } from './firebase-config';
import type { Project } from '.';

/** Who's signed in to Firebase. */
export type CloudUser = { uid: string; name: string; email: string };

/**
 * Set while someone's signed in, so the next visit connects at once; without
 * it Firebase's code is only fetched when the projects menu is opened.
 */
const SIGNED_IN_KEY = 'cloudSignedIn';

/** The longest stored model the database's rules take (characters). */
const MAX_MODEL_LENGTH = 10_000_000;

type List = 'projects' | 'projectModels' | 'tools';

type Sdk = {
  auth: Auth;
  db: Database;
  authApi: typeof import('firebase/auth');
  dbApi: typeof import('firebase/database');
};

/**
 * Projects kept in Firebase for whoever's signed in (with Google), so every
 * browser they sign in from has them: under `users/<uid>` in the Realtime
 * Database, `projects/<id>` a project's name and time — listened to, so the
 * list follows what other browsers do — and `projectModels/<id>` its model,
 * gzipped and base64 like the one in a .nc file (the database would drop
 * empty lists from a model stored as it is). Their tool library is there
 * too: `tools/<key>`, each tool as JSON with its time. The rules
 * (`database.rules.json`) give each user their own branch only.
 */
@Injectable({ providedIn: 'root' })
export class CloudProjects {
  /** Who's signed in: null for nobody, undefined while that isn't known. */
  readonly user$ = new BehaviorSubject<CloudUser | null | undefined>(
    wasSignedIn() ? undefined : null,
  );

  /**
   * The signed-in user's projects, most recently saved first; null while
   * they aren't known (nobody signed in, or still being read).
   */
  readonly projects$ = new BehaviorSubject<Project[] | null>(null);

  /**
   * Their tool library there, by name; null while it isn't known (nobody
   * signed in, or still being read).
   */
  readonly tools$ = new BehaviorSubject<LibraryEntry[] | null>(null);

  private sdk: Promise<Sdk> | null = null;
  private stopListening: (() => void) | null = null;

  constructor() {
    if (wasSignedIn()) {
      this.start();
    }
  }

  /** Connects, if that's not done yet: who's signed in gets known. */
  start() {
    this.connect().catch((error) =>
      console.warn('[cloud] Firebase couldn’t be loaded', error),
    );
  }

  /** Signs in with Google, in a popup; closing it is no error. */
  async signIn() {
    const { auth, authApi } = await this.connect();
    try {
      await authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider());
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (
        code !== 'auth/popup-closed-by-user' &&
        code !== 'auth/cancelled-popup-request' &&
        code !== 'auth/user-cancelled'
      ) {
        throw error;
      }
    }
  }

  async signOut() {
    const { auth, authApi } = await this.connect();
    await authApi.signOut(auth);
  }

  /**
   * A project's model, in the current format; undefined when there's no
   * such project. Throws when it can't be read.
   */
  async load(id: string): Promise<ModelType | undefined> {
    const { db, dbApi } = await this.online();
    const stored = await dbApi.get(
      dbApi.ref(db, this.path('projectModels', id)),
    );
    return stored.exists()
      ? migrateModel(await loadModelFromMetadata(stored.val()))
      : undefined;
  }

  /** Saves (or replaces) a project and its model. */
  async put(project: Project, model: ModelType) {
    const { db, dbApi } = await this.online();
    const stored = await getModelMetadata(model);
    if (stored.length > MAX_MODEL_LENGTH) {
      const mb = (length: number) => (length / 1e6).toFixed(1);
      throw new Error(
        `The project is too big to keep in Firebase (${mb(stored.length)} MB, of ${mb(MAX_MODEL_LENGTH)} at most): pictures and imported files make a project big.`,
      );
    }
    const { id, name, savedAt } = project;
    // Both or neither.
    await dbApi.update(dbApi.ref(db), {
      [this.path('projects', id)]: { name, savedAt },
      [this.path('projectModels', id)]: stored,
    });
  }

  async delete(id: string) {
    const { db, dbApi } = await this.online();
    await dbApi.update(dbApi.ref(db), {
      [this.path('projects', id)]: null,
      [this.path('projectModels', id)]: null,
    });
  }

  /** Keeps (or replaces) a tool in the library there. */
  async putTool({ key, tool, savedAt }: LibraryEntry) {
    const { db, dbApi } = await this.online();
    await dbApi.set(dbApi.ref(db, this.path('tools', key)), {
      tool: JSON.stringify(tool),
      savedAt,
    });
  }

  async deleteTool(key: string) {
    const { db, dbApi } = await this.online();
    await dbApi.remove(dbApi.ref(db, this.path('tools', key)));
  }

  private path(list: List, id: string): string {
    const user = this.user$.value;
    if (!user) {
      throw new Error('Sign in to Firebase first.');
    }
    return `users/${user.uid}/${list}/${id}`;
  }

  /**
   * Connected, to read or write: not while offline, when a request would
   * only wait (a write's answer comes once it has reached the server).
   */
  private async online(): Promise<Sdk> {
    if (navigator.onLine === false) {
      throw new Error('You’re offline: Firebase can’t be reached.');
    }
    return this.connect();
  }

  /** Firebase's code is fetched when first needed (it's big). */
  private connect(): Promise<Sdk> {
    this.sdk ??= this.initialize().catch((error) => {
      // The next call tries again.
      this.sdk = null;
      throw error;
    });
    return this.sdk;
  }

  private async initialize(): Promise<Sdk> {
    const [{ initializeApp }, authApi, dbApi] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ]);
    const app = initializeApp(FIREBASE_CONFIG);
    const sdk: Sdk = {
      auth: authApi.getAuth(app),
      db: dbApi.getDatabase(app),
      authApi,
      dbApi,
    };
    authApi.onAuthStateChanged(sdk.auth, (user) => this.onUser(sdk, user));
    return sdk;
  }

  /** Someone signed in or out: their projects are the ones to list. */
  private onUser({ db, dbApi }: Sdk, user: User | null) {
    this.stopListening?.();
    this.stopListening = null;
    remember(!!user);
    this.projects$.next(null);
    this.tools$.next(null);
    this.user$.next(
      user && {
        uid: user.uid,
        name: user.displayName ?? '',
        email: user.email ?? '',
      },
    );
    if (user) {
      const stopProjects = dbApi.onValue(
        dbApi.ref(db, `users/${user.uid}/projects`),
        (list) => this.projects$.next(projectsIn(list.val())),
        (error) => reportError('reading the projects in Firebase', error),
      );
      const stopTools = dbApi.onValue(
        dbApi.ref(db, `users/${user.uid}/tools`),
        (list) => this.tools$.next(toolsIn(list.val())),
        (error) => reportError('reading the tool library in Firebase', error),
      );
      this.stopListening = () => {
        stopProjects();
        stopTools();
      };
    }
  }
}

/** The projects in a stored list (by id), most recently saved first. */
export function projectsIn(list: unknown): Project[] {
  return Object.entries((list as Record<string, Partial<Project>>) ?? {})
    .filter(
      ([, project]) =>
        typeof project?.name === 'string' &&
        typeof project.savedAt === 'number',
    )
    .map(([id, project]) => ({
      id,
      name: project.name!,
      savedAt: project.savedAt!,
      cloud: true as const,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** The tools in a stored library (by key), by name. */
export function toolsIn(list: unknown): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const [key, stored] of Object.entries(
    (list as Record<string, { tool?: unknown; savedAt?: unknown }>) ?? {},
  )) {
    if (typeof stored?.tool !== 'string') continue;
    try {
      const tool = JSON.parse(stored.tool);
      if (tool && typeof tool === 'object') {
        entries.push({ key, tool, savedAt: Number(stored.savedAt) || 0 });
      }
    } catch {
      // Not a tool: left out.
    }
  }
  return sortedByName(entries);
}

function wasSignedIn(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(signedIn: boolean) {
  try {
    if (signedIn) {
      localStorage.setItem(SIGNED_IN_KEY, '1');
    } else {
      localStorage.removeItem(SIGNED_IN_KEY);
    }
  } catch {
    // Without it, the next visit connects when the menu is opened.
  }
}
