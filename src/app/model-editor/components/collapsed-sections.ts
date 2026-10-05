/** Which editor sections are collapsed, remembered across reloads. */
const COLLAPSED_STORAGE_KEY = 'ui.collapsedSections';

export function readCollapsedSections(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeCollapsedSections(keys: string[]) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(keys));
  } catch {}
}
