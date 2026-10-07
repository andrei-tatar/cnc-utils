import { CONSTANTS, FUNCTIONS, UNITS } from './expression';

/** Something to complete the word at the caret with. */
export type Suggestion = {
  kind: 'variable' | 'constant' | 'function' | 'unit';
  /** What's shown, e.g. `sqrt(x)`. */
  label: string;
  /** What replaces the word, e.g. `sqrt(`. */
  insert: string;
  /** Shown beside it: a value, or what a unit is. */
  detail: string;
};

export type Completion = {
  /** The part of the text the suggestion replaces. */
  from: number;
  to: number;
  items: Suggestion[];
};

/** Up to 4 decimals, as the number field shows results. */
export function roundForDisplay(value: number): string {
  return String(Math.round(value * 1e4) / 1e4);
}

/**
 * What the word at `caret` could be: a variable in `scope`, a constant or a
 * function, or a unit when it follows a number. `all`: also when nothing is
 * typed yet (asked for with Ctrl+Space). `null` when there's nothing to say.
 */
export function suggest(
  text: string,
  caret: number,
  scope: ReadonlyMap<string, number>,
  all = false,
): Completion | null {
  const before = text.slice(0, caret);
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
  const from = caret - word.length;
  if (!word && !all) {
    return null;
  }
  const to =
    caret + (/^[A-Za-z0-9_]*/.exec(text.slice(caret))?.[0].length ?? 0);
  // Right after a number (not a name like `x1`), it's that number's unit.
  const afterNumber = /(^|[^A-Za-z0-9_.])(\d+\.?\d*|\.\d+)\s*$/.test(
    text.slice(0, from),
  );

  const candidates: Suggestion[] = afterNumber
    ? Object.entries(UNITS).map(([name, mm]): Suggestion => ({
        kind: 'unit',
        label: name,
        insert: name,
        detail: name === 'mm' ? 'millimetres' : `${mm} mm`,
      }))
    : [
        ...[...scope].map(([name, value]): Suggestion => ({
          kind: 'variable',
          label: name,
          insert: name,
          detail: roundForDisplay(value),
        })),
        ...Object.entries(CONSTANTS).map(([name, value]): Suggestion => ({
          kind: 'constant',
          label: name,
          insert: name,
          detail: roundForDisplay(value),
        })),
        ...Object.entries(FUNCTIONS).map(([name, fn]): Suggestion => ({
          kind: 'function',
          label: `${name}(${fn.args ?? 'x'})`,
          insert: `${name}(`,
          detail: 'function',
        })),
      ];

  const prefix = word.toLowerCase();
  const name = (s: Suggestion) => s.insert.replace(/\($/, '').toLowerCase();
  const items = [
    // Those starting with what's typed first, then those containing it.
    ...candidates.filter((s) => name(s).startsWith(prefix)),
    ...candidates.filter(
      (s) => prefix && !name(s).startsWith(prefix) && name(s).includes(prefix),
    ),
  ].filter((s) => s.insert !== word);
  return items.length ? { from, to, items } : null;
}
