import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FieldType } from '@ngx-formly/bootstrap/form-field';
import { FormlyModule } from '@ngx-formly/core';
import { Subscription } from 'rxjs';
import {
  FONT_CATALOG_URL,
  FontCatalogEntry,
  FontRef,
  fontFileUrl,
  fontInfoUrl,
  fontUnicodeUrl,
  nearestWeight,
  parseUnicodeRange,
} from '../../../cam/font-source';

/** Shown first when nothing is typed: widely used and CNC-friendly faces. */
const POPULAR = [
  'roboto',
  'open-sans',
  'montserrat',
  'lato',
  'oswald',
  'bebas-neue',
  'poppins',
  'raleway',
  'playfair-display',
  'merriweather',
  'roboto-slab',
  'roboto-mono',
  'source-code-pro',
  'pacifico',
  'lobster',
  'dancing-script',
  'great-vibes',
  'caveat',
  'black-ops-one',
  'allerta-stencil',
  'stardos-stencil',
  'staatliches',
  'anton',
  'archivo-black',
];

const CATEGORIES = [
  { value: '', label: 'all' },
  { value: 'sans-serif', label: 'sans' },
  { value: 'serif', label: 'serif' },
  { value: 'display', label: 'display' },
  { value: 'handwriting', label: 'script' },
  { value: 'monospace', label: 'mono' },
];

const MAX_RESULTS = 60;

let catalog: Promise<FontCatalogEntry[]> | null = null;

/** The Google Fonts catalog (via Fontsource), fetched once per session. */
function loadCatalog(): Promise<FontCatalogEntry[]> {
  catalog ??= fetch(FONT_CATALOG_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<FontCatalogEntry[]>;
    })
    .then((all) => all.filter((f) => f.type === 'google'))
    .catch((error) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

const coverage = new Map<string, Promise<Array<[number, number]>>>();

/** Every code point range the font's subset files cover. */
function loadCoverage(font: FontRef): Promise<Array<[number, number]>> {
  const url = fontUnicodeUrl(font);
  if (!coverage.has(url)) {
    const request = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<Record<string, string>>;
      })
      .then((ranges) => Object.values(ranges).flatMap(parseUnicodeRange));
    request.catch(() => coverage.delete(url));
    coverage.set(url, request);
  }
  return coverage.get(url)!;
}

const previews = new Map<string, Promise<void>>();

/**
 * Register a font with the browser so its name can be drawn in its own face.
 * Uses the small WOFF2 file of the default subset.
 */
function loadPreview(
  font: { id: string; version?: string; defSubset?: string },
  weight: number,
  style: string,
): Promise<void> {
  const family = previewFamily(font.id, weight, style);
  if (!previews.has(family)) {
    const face = new FontFace(
      family,
      `url(${fontFileUrl(font, font.defSubset ?? 'latin', weight, style, 'woff2')})`,
    );
    previews.set(
      family,
      face.load().then(
        (loaded) => {
          // FontFaceSet.add is missing from TypeScript's DOM typings.
          (document.fonts as unknown as Set<FontFace>).add(loaded);
        },
        () => {},
      ),
    );
  }
  return previews.get(family)!;
}

function previewFamily(id: string, weight: number, style: string) {
  return `cnc-preview-${id}-${weight}-${style}`;
}

@Component({
  imports: [FormlyModule],
  styles: `
    :host {
      display: block;
      flex: 1;
      min-width: 0;
    }

    .current {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
      padding: 0.25rem 0.5rem;
      font-size: 0.85rem;
    }

    .current_name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1.05rem;
    }

    .current_hint {
      font-size: 0.7rem;
      color: var(--bs-secondary-color);
    }

    .missing {
      margin-top: 4px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--bs-warning-text-emphasis);
      background: var(--bs-warning-bg-subtle);
    }

    .panel {
      margin-top: 6px;
      border: 1px solid var(--editor-border);
      border-radius: 8px;
      background: var(--editor-card-bg);
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
      overflow: hidden;
    }

    .panel_search {
      padding: 6px;
      border-bottom: 1px solid var(--editor-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .categories {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .category {
      font-size: 0.7rem;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid var(--editor-border);
      background: transparent;
      color: var(--bs-secondary-color);

      &.active {
        background: var(--bs-primary);
        border-color: var(--bs-primary);
        color: #fff;
      }
    }

    .results {
      max-height: 280px;
      overflow-y: auto;
      margin: 0;
      padding: 4px 0;
      list-style: none;
    }

    .result {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 4px 10px;
      cursor: pointer;

      &:hover,
      &.highlighted {
        background: var(--editor-hover-bg);
      }

      &.selected {
        background: color-mix(in srgb, var(--bs-primary) 10%, transparent);
      }
    }

    .result_name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1.1rem;
    }

    .result_category {
      font-size: 0.65rem;
      color: var(--bs-secondary-color);
      white-space: nowrap;
    }

    .status {
      padding: 10px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
    }

    .attribution {
      padding: 4px 10px;
      border-top: 1px solid var(--editor-border);
      font-size: 0.65rem;
      color: var(--bs-secondary-color);
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button
      type="button"
      class="form-control current"
      [attr.aria-expanded]="open"
      (click)="toggle()"
    >
      <span class="current_name" [style.font-family]="currentPreviewFamily">
        {{ value?.family ?? 'choose a font' }}
      </span>
      <span class="current_hint">{{ open ? 'close' : 'change' }}</span>
    </button>

    @if (missing.length) {
      <div class="missing" role="alert">
        ⚠ {{ value?.family }} has no
        {{ missing.length === 1 ? 'glyph' : 'glyphs' }} for
        <strong>{{ missing.join(' ') }}</strong> — they will be left out.
      </div>
    }

    @if (open) {
      <div class="panel">
        <div class="panel_search">
          <input
            #search
            class="form-control"
            type="search"
            placeholder="Search Google Fonts…"
            [value]="query"
            (input)="setQuery($any($event.target).value)"
            (keydown)="onKeydown($event)"
          />
          <div class="categories">
            @for (c of categories; track c.value) {
              <button
                type="button"
                class="category"
                [class.active]="category === c.value"
                (click)="setCategory(c.value)"
              >
                {{ c.label }}
              </button>
            }
          </div>
        </div>

        @if (error) {
          <div class="status">
            Couldn't load the font list ({{ error }}).
            <button
              type="button"
              class="btn btn-link btn-sm p-0"
              (click)="reload()"
            >
              Retry
            </button>
          </div>
        } @else if (!fonts) {
          <div class="status">Loading Google Fonts…</div>
        } @else {
          <ul class="results" #resultList role="listbox">
            @for (font of results; track font.id; let i = $index) {
              <li
                class="result"
                role="option"
                [attr.data-font-id]="font.id"
                [attr.aria-selected]="font.id === value?.id"
                [class.selected]="font.id === value?.id"
                [class.highlighted]="i === highlighted"
                (click)="select(font)"
              >
                <span
                  class="result_name"
                  [style.font-family]="previewFamilyFor(font)"
                  >{{ font.family }}</span
                >
                <span class="result_category">{{ font.category }}</span>
              </li>
            } @empty {
              <li class="status">No fonts match “{{ query }}”.</li>
            }
            @if (matchCount > results.length) {
              <li class="status">
                {{ matchCount - results.length }} more — keep typing to narrow
                down.
              </li>
            }
          </ul>
        }
        <div class="attribution">
          Google Fonts via Fontsource · open-source licenses
        </div>
      </div>
    }
  `,
})
export class FontTypeComponent
  extends FieldType
  implements OnInit, AfterViewChecked, OnDestroy
{
  private changes = inject(ChangeDetectorRef);
  private host = inject(ElementRef);

  @ViewChild('search') search?: ElementRef<HTMLInputElement>;
  @ViewChild('resultList') resultsList?: ElementRef<HTMLElement>;

  readonly categories = CATEGORIES;
  open = false;
  query = '';
  category = '';
  fonts: FontCatalogEntry[] | null = null;
  results: FontCatalogEntry[] = [];
  matchCount = 0;
  highlighted = 0;
  error: string | null = null;
  /** Characters in the text that the selected font can't draw. */
  missing: string[] = [];

  private subscriptions = new Subscription();
  private loadedPreviews = new Set<string>();
  private observer?: IntersectionObserver;
  private observed = new WeakSet<Element>();
  private focusSearch = false;

  get value(): FontRef | undefined {
    return this.formControl.value;
  }

  get currentPreviewFamily() {
    const font = this.value;
    if (!font) return null;
    const weight = this.form.get('fontWeight')?.value ?? 400;
    const style = this.form.get('fontStyle')?.value ?? 'normal';
    const family = previewFamily(font.id, weight, style);
    return this.loadedPreviews.has(family) ? `"${family}", sans-serif` : null;
  }

  ngOnInit() {
    this.previewCurrent();
    this.checkCoverage();
    for (const control of [this.formControl, this.form.get('text')]) {
      if (control) {
        this.subscriptions.add(
          control.valueChanges.subscribe(() => this.checkCoverage()),
        );
      }
    }
    for (const control of [
      this.formControl,
      this.form.get('fontWeight'),
      this.form.get('fontStyle'),
    ]) {
      if (control) {
        this.subscriptions.add(
          control.valueChanges.subscribe(() => this.previewCurrent()),
        );
      }
    }
  }

  ngAfterViewChecked() {
    if (this.focusSearch && this.search) {
      this.focusSearch = false;
      this.search.nativeElement.focus();
    }
    this.observeResults();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.observer?.disconnect();
  }

  toggle() {
    this.open = !this.open;
    if (this.open) {
      this.focusSearch = true;
      this.reload();
    }
  }

  reload() {
    this.error = null;
    loadCatalog().then(
      (fonts) => {
        this.fonts = fonts;
        this.filter();
        this.changes.markForCheck();
      },
      (error) => {
        this.error = String(error?.message ?? error);
        this.changes.markForCheck();
      },
    );
  }

  setQuery(query: string) {
    this.query = query;
    this.filter();
  }

  setCategory(category: string) {
    this.category = category;
    this.filter();
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.highlighted = Math.max(
        0,
        Math.min(this.results.length - 1, this.highlighted + delta),
      );
      this.resultsList?.nativeElement
        .querySelectorAll('.result')
        [this.highlighted]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const font = this.results[this.highlighted];
      if (font) this.select(font);
    } else if (event.key === 'Escape') {
      this.open = false;
    }
  }

  async select(font: FontCatalogEntry) {
    this.open = false;

    // Pin the package version so the outlines can't change under a saved
    // project; fall back to "latest" if the lookup fails.
    let version = 'latest';
    try {
      const info = await fetch(fontInfoUrl(font.id)).then((r) => r.json());
      version = info.npmVersion ?? version;
    } catch {}

    const ref: FontRef = {
      id: font.id,
      family: font.family,
      version,
      weights: font.weights,
      styles: font.styles,
    };

    // Keep weight and style valid for the new font.
    const weight = this.form.get('fontWeight');
    if (weight && !font.weights.includes(weight.value)) {
      weight.setValue(nearestWeight(font.weights, weight.value ?? 400));
    }
    const style = this.form.get('fontStyle');
    if (style && !font.styles.includes(style.value)) {
      style.setValue(
        font.styles.includes('normal') ? 'normal' : font.styles[0],
      );
    }

    this.formControl.setValue(ref);
    this.formControl.markAsDirty();
    this.changes.markForCheck();
  }

  previewFamilyFor(font: FontCatalogEntry) {
    const family = previewFamily(
      font.id,
      previewWeight(font),
      previewStyle(font),
    );
    return this.loadedPreviews.has(family) ? `"${family}", sans-serif` : null;
  }

  private filter() {
    if (!this.fonts) return;
    const query = this.query.trim().toLowerCase();

    const matches = this.fonts.filter(
      (f) =>
        (!this.category || f.category === this.category) &&
        (!query || f.family.toLowerCase().includes(query)),
    );

    const rank = (f: FontCatalogEntry) => {
      if (query) {
        const family = f.family.toLowerCase();
        return family === query ? 0 : family.startsWith(query) ? 1 : 2;
      }
      const popular = POPULAR.indexOf(f.id);
      return popular === -1 ? POPULAR.length : popular;
    };

    matches.sort(
      (a, b) => rank(a) - rank(b) || a.family.localeCompare(b.family),
    );

    this.matchCount = matches.length;
    this.results = matches.slice(0, MAX_RESULTS);
    this.highlighted = 0;
  }

  /** Load previews only for entries that scroll into view. */
  private observeResults() {
    const list = this.resultsList?.nativeElement;
    if (!list) return;

    this.observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset['fontId'];
          const font = this.fonts?.find((f) => f.id === id);
          if (font) {
            this.observer!.unobserve(entry.target);
            const weight = previewWeight(font);
            const style = previewStyle(font);
            loadPreview(font, weight, style).then(() => {
              this.loadedPreviews.add(previewFamily(font.id, weight, style));
              this.changes.markForCheck();
            });
          }
        }
      },
      { root: list, rootMargin: '100px' },
    );

    list.querySelectorAll('.result').forEach((item) => {
      if (!this.observed.has(item)) {
        this.observed.add(item);
        this.observer!.observe(item);
      }
    });
  }

  private coverageCheck = 0;

  private checkCoverage() {
    const font = this.value;
    const text: string = this.form.get('text')?.value ?? '';
    const check = ++this.coverageCheck;
    if (!font) {
      this.missing = [];
      return;
    }

    loadCoverage(font).then(
      (ranges) => {
        if (check !== this.coverageCheck) return;
        this.missing = [...new Set(text)].filter((char) => {
          if (/\s/.test(char)) return false;
          const code = char.codePointAt(0)!;
          return !ranges.some(([start, end]) => code >= start && code <= end);
        });
        this.changes.markForCheck();
      },
      () => {},
    );
  }

  private previewCurrent() {
    const font = this.value;
    if (!font) return;
    const weight = this.form.get('fontWeight')?.value ?? 400;
    const style = this.form.get('fontStyle')?.value ?? 'normal';
    loadPreview(font, weight, style).then(() => {
      this.loadedPreviews.add(previewFamily(font.id, weight, style));
      this.changes.markForCheck();
    });
  }
}

function previewWeight(font: FontCatalogEntry) {
  return nearestWeight(font.weights, 400);
}

function previewStyle(font: FontCatalogEntry) {
  return font.styles.includes('normal') ? 'normal' : font.styles[0];
}
