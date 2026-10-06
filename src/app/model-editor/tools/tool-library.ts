import {
  openAppDb,
  requestResult,
  TOOLS_STORE,
  transactionDone,
} from '../../services/app-db';
import { generateId } from '../../../util';
import type { ToolType } from '.';

/** A tool's settings, without what only means something in a project. */
export type LibraryTool = Omit<ToolType, 'id' | 'expanded'>;

/** A tool kept in the library, shared by all projects. */
export type LibraryEntry = {
  key: string;
  tool: LibraryTool;
  savedAt: number;
};

/** The format of an exported library file. */
type LibraryFile = { cncUtilsToolLibrary: 1; tools: LibraryTool[] };

export function librarySettings(tool: ToolType | LibraryTool): LibraryTool {
  const { id: _, expanded: __, ...settings } = tool as ToolType;
  return structuredClone(settings);
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openAppDb();
  if (!db) return [];
  const entries = (await requestResult(
    db.transaction(TOOLS_STORE).objectStore(TOOLS_STORE).getAll(),
  )) as LibraryEntry[];
  return entries.sort((a, b) =>
    libraryName(a.tool).localeCompare(libraryName(b.tool)),
  );
}

/**
 * Keep `tool` in the library. A library tool with the same name is
 * replaced (so saving again updates it); unnamed tools are only added once.
 */
export async function saveToLibrary(tool: ToolType | LibraryTool) {
  const settings = librarySettings(tool);
  const existing = (await listLibrary()).find((entry) =>
    settings.name
      ? entry.tool.name === settings.name
      : JSON.stringify(entry.tool) === JSON.stringify(settings),
  );
  await put({
    key: existing?.key ?? (await generateId()),
    tool: settings,
    savedAt: Date.now(),
  });
}

export async function removeFromLibrary(key: string) {
  const db = await openAppDb();
  if (!db) return;
  const tx = db.transaction(TOOLS_STORE, 'readwrite');
  tx.objectStore(TOOLS_STORE).delete(key);
  await transactionDone(tx);
}

export async function exportLibrary(): Promise<string> {
  const file: LibraryFile = {
    cncUtilsToolLibrary: 1,
    tools: (await listLibrary()).map((entry) => entry.tool),
  };
  return JSON.stringify(file, null, 2);
}

/** Add the tools in an exported library file; returns how many. */
export async function importLibrary(text: string): Promise<number> {
  const file = JSON.parse(text) as Partial<LibraryFile>;
  if (file?.cncUtilsToolLibrary !== 1 || !Array.isArray(file.tools)) {
    throw new Error('This isn’t a tool library file.');
  }
  for (const tool of file.tools) {
    if (tool && typeof tool === 'object' && typeof tool.diameter === 'number') {
      await saveToLibrary(tool);
    }
  }
  return file.tools.length;
}

export function libraryName(tool: LibraryTool): string {
  return tool.name || '';
}

async function put(entry: LibraryEntry) {
  const db = await openAppDb();
  if (!db) {
    throw new Error('The tool library can’t be stored in this browser.');
  }
  const tx = db.transaction(TOOLS_STORE, 'readwrite');
  tx.objectStore(TOOLS_STORE).put(entry, entry.key);
  await transactionDone(tx);
}
