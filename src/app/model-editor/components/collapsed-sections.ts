import { BehaviorSubject, Observable } from 'rxjs';

/** Which editor sections are collapsed, remembered across reloads. */
const COLLAPSED_STORAGE_KEY = 'ui.collapsedSections';

function load(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const collapsed = new BehaviorSubject<string[]>(load());

/** The collapsed sections' keys (`shapes`, `operations`, …), as they change. */
export const collapsedSections$: Observable<string[]> =
  collapsed.asObservable();

export function readCollapsedSections(): string[] {
  return collapsed.value;
}

export function writeCollapsedSections(keys: string[]) {
  collapsed.next(keys);
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(keys));
  } catch {}
}
