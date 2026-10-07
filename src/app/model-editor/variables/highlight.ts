import { CONSTANTS, FUNCTIONS, UNITS } from './expression';

export type TokenKind =
  | 'number'
  | 'unit'
  | 'variable'
  | 'constant'
  | 'function'
  | 'unknown'
  | 'operator'
  | 'paren'
  | 'space'
  | 'error';

/** A piece of an expression (starting at `from`) and what it is. */
export type Span = { text: string; kind: TokenKind; from: number };

const PIECE =
  /(\s+)|((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/%^,])|([()])|(.)/sy;

/**
 * The pieces of `text`, joined back together exactly, each with its kind:
 * names are told apart with `scope` (the variables the field can use).
 * Unlike the parser it never fails: anything it can't read is an `error`.
 */
export function highlight(
  text: string,
  scope: ReadonlyMap<string, number>,
): Span[] {
  const spans: Span[] = [];
  let afterNumber = false;
  let depth = 0;
  PIECE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PIECE.exec(text))) {
    const [piece, space, number, name, operator, paren] = match;
    let kind: TokenKind;
    if (space !== undefined) {
      spans.push({ text: piece, kind: 'space', from: match.index });
      continue;
    } else if (number !== undefined) {
      kind = 'number';
    } else if (name !== undefined) {
      const isCall = /^\s*\(/.test(text.slice(PIECE.lastIndex));
      kind = nameKind(name, scope, isCall, afterNumber);
    } else if (operator !== undefined) {
      kind = 'operator';
    } else if (paren !== undefined) {
      kind = paren === '(' || depth > 0 ? 'paren' : 'error';
      depth = Math.max(0, depth + (paren === '(' ? 1 : -1));
    } else {
      kind = 'error';
    }
    afterNumber = kind === 'number';
    spans.push({ text: piece, kind, from: match.index });
  }
  return spans;
}

function nameKind(
  name: string,
  scope: ReadonlyMap<string, number>,
  isCall: boolean,
  afterNumber: boolean,
): TokenKind {
  if (isCall) {
    return Object.hasOwn(FUNCTIONS, name) ? 'function' : 'unknown';
  }
  if (afterNumber && Object.hasOwn(UNITS, name)) {
    return 'unit';
  }
  if (scope.has(name)) {
    return 'variable';
  }
  if (Object.hasOwn(CONSTANTS, name)) {
    return 'constant';
  }
  return Object.hasOwn(FUNCTIONS, name) ? 'function' : 'unknown';
}
