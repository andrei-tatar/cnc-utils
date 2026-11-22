// The parts of Monaco the G-code panel uses: the editor without the
// languages it comes with, and a few of its features. A chunk of its own,
// fetched when the panel is first opened (`loadMonaco` in
// `gcode-view.component.ts`); its stylesheet is the `monaco` style bundle
// in `angular.json`, linked then too (the CSS its modules import is left
// out of the build: `loader` there).
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';

export { monaco };

export const GCODE_LANGUAGE = 'gcode';
export const GCODE_THEME = 'cnc-gcode';

(globalThis as any).MonacoEnvironment = {
  getWorker: () =>
    new Worker(new URL('./editor.worker', import.meta.url), { type: 'module' }),
};

/** Lines that fold together, per document: a program's operations. */
const foldingRanges = new WeakMap<
  monaco.editor.ITextModel,
  monaco.languages.FoldingRange[]
>();

/** What folds in `model`: `sections`, as first and last lines from 0. */
export function setFolding(
  model: monaco.editor.ITextModel,
  sections: { first: number; last: number }[],
) {
  foldingRanges.set(
    model,
    sections
      .filter((s) => s.last > s.first)
      .map((s) => ({ start: s.first + 1, end: s.last + 1 })),
  );
}

monaco.languages.register({ id: GCODE_LANGUAGE });
monaco.languages.setMonarchTokensProvider(GCODE_LANGUAGE, {
  ignoreCase: true,
  tokenizer: {
    root: [
      [/;.*$/, 'comment'],
      [/\(.*?\)/, 'comment'],
      // Rapids apart from cuts: which is which matters most.
      [/G0?0(?![\d.])/, 'gcode.rapid'],
      [/G0?[123](?![\d.])/, 'gcode.cut'],
      [/[GM]\d+(\.\d+)?/, 'gcode.code'],
      [/T\d+/, 'gcode.tool'],
      [/[FS]-?\d*\.?\d+/, 'gcode.feed'],
      [/[XYZABCIJKRQP]-?\d*\.?\d+/, 'gcode.coordinate'],
    ],
  },
});
monaco.languages.registerFoldingRangeProvider(GCODE_LANGUAGE, {
  provideFoldingRanges: (model) => foldingRanges.get(model) ?? [],
});

/**
 * The editor's theme from the app's own colours as they are now (the
 * `--code-*` tokens in `styles.scss`, which follow the app's theme): call
 * it again when that changes.
 */
export function applyGcodeTheme(dark: boolean) {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const rule = (name: string, color: string) => ({
    token: name,
    foreground: color.slice(1),
  });
  monaco.editor.defineTheme(GCODE_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      rule('comment', token('--code-operator', '#6e7781')),
      rule('gcode.rapid', token('--code-constant', '#b35900')),
      rule('gcode.cut', token('--code-function', '#1a7f37')),
      rule('gcode.code', token('--code-variable', '#7c3aed')),
      rule('gcode.tool', token('--code-constant', '#b35900')),
      rule('gcode.feed', token('--code-unit', '#0a7c86')),
      rule('gcode.coordinate', token('--code-number', '#0550ae')),
    ],
    colors: {
      'editor.background': token(
        '--editor-card-bg',
        dark ? '#1b2029' : '#ffffff',
      ),
    },
  });
  monaco.editor.setTheme(GCODE_THEME);
}
