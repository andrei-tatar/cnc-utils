export const DEFAULT_EDITOR_WIDTH = 420;

const EDITOR_WIDTH_STORAGE_KEY = 'ui.editorWidth';
const MIN_EDITOR_WIDTH = 280;
const MIN_VIEWER_WIDTH = 200;

/** Keeps the editor at its minimum width, leaving the viewer its own. */
export function clampEditorWidth(width: number): number {
  const max = Math.max(MIN_EDITOR_WIDTH, window.innerWidth - MIN_VIEWER_WIDTH);
  return Math.round(Math.min(max, Math.max(MIN_EDITOR_WIDTH, width)));
}

/** The width saved last time, fitted to the current window. */
export function loadEditorWidth(): number {
  try {
    const stored = Number(localStorage.getItem(EDITOR_WIDTH_STORAGE_KEY));
    if (stored >= MIN_EDITOR_WIDTH) {
      return clampEditorWidth(stored);
    }
  } catch {}
  return DEFAULT_EDITOR_WIDTH;
}

export function saveEditorWidth(width: number) {
  try {
    localStorage.setItem(EDITOR_WIDTH_STORAGE_KEY, String(width));
  } catch {}
}
