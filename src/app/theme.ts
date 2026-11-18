import { Injectable, signal } from '@angular/core';

/** What the theme picker offers: `system` follows the device's setting. */
export const THEMES = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
] as const;

export type ThemeChoice = (typeof THEMES)[number]['id'];

/**
 * Where the choice is kept. The script in `index.html` reads it too, so the
 * splash already has the theme's colours.
 */
const STORAGE_KEY = 'ui.theme';

/** The theme picked in this browser (the device's at first). */
export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (THEMES.some((theme) => theme.id === stored)) {
      return stored as ThemeChoice;
    }
  } catch {}
  return 'system';
}

/**
 * The app's light or dark theme: Bootstrap's colour mode (`data-bs-theme`
 * on the document), which the editor's own tokens in `styles.scss` follow.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  readonly choice = signal<ThemeChoice>(loadTheme());
  /** Whether the theme shown is the dark one. */
  readonly dark = signal(false);

  private readonly devicePrefersDark = window.matchMedia(
    '(prefers-color-scheme: dark)',
  );

  constructor() {
    this.devicePrefersDark.addEventListener('change', () => this.apply());
    this.apply();
  }

  set(choice: ThemeChoice) {
    this.choice.set(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Storage unavailable: it's only kept for this page load.
    }
    this.apply();
  }

  private apply() {
    const choice = this.choice();
    const dark =
      choice === 'dark' ||
      (choice === 'system' && this.devicePrefersDark.matches);
    this.dark.set(dark);
    document.documentElement.dataset['bsTheme'] = dark ? 'dark' : 'light';
  }
}
