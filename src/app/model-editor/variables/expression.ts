/**
 * Arithmetic expressions for number fields, e.g. `sqrt(2) * width / 2`.
 *
 * Numbers, variables, `+ - * / %`, `^` (or `**`) for powers, parentheses
 * and the functions below. Angles are in radians (`rad(45)`, `deg(x)`
 * convert). A number can have a length unit (`1cm` is 10; without one it's
 * in mm). Parsed by hand: nothing is ever `eval`ed.
 */

/** Something wrong with an expression, in words for the user. */
export class ExpressionError extends Error {
  constructor(
    message: string,
    /** The variable that isn't known, when that's the problem. */
    readonly unknownName?: string,
  ) {
    super(message);
  }
}

export const CONSTANTS: Record<string, number> = { pi: Math.PI };

/**
 * Length units, in millimetres, written right after a number: `1cm`,
 * `2.5 in`. They belong to that number only (`2 * 3cm` is 60), except that
 * a fraction of whole numbers takes the unit as a whole: `1/4in` is 6.35.
 */
export const UNITS: Record<string, number> = {
  mm: 1,
  cm: 10,
  dm: 100,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  thou: 0.0254,
};

/** Functions, and how many arguments they take (`max` of -1: any). */
export const FUNCTIONS: Record<
  string,
  {
    min: number;
    max: number;
    fn: (...args: number[]) => number;
    /** The arguments, for suggestions: `x` unless said. */
    args?: string;
  }
> = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  cbrt: { min: 1, max: 1, fn: Math.cbrt },
  abs: { min: 1, max: 1, fn: Math.abs },
  sign: { min: 1, max: 1, fn: Math.sign },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  round: { min: 1, max: 1, fn: Math.round },
  trunc: { min: 1, max: 1, fn: Math.trunc },
  sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos },
  tan: { min: 1, max: 1, fn: Math.tan },
  asin: { min: 1, max: 1, fn: Math.asin },
  acos: { min: 1, max: 1, fn: Math.acos },
  atan: { min: 1, max: 1, fn: Math.atan },
  atan2: { min: 2, max: 2, fn: Math.atan2, args: 'y, x' },
  exp: { min: 1, max: 1, fn: Math.exp },
  ln: { min: 1, max: 1, fn: Math.log },
  log: { min: 1, max: 1, fn: Math.log10 },
  log2: { min: 1, max: 1, fn: Math.log2 },
  pow: { min: 2, max: 2, fn: Math.pow, args: 'x, y' },
  hypot: { min: 1, max: -1, fn: Math.hypot, args: 'a, b, …' },
  min: { min: 1, max: -1, fn: Math.min, args: 'a, b, …' },
  max: { min: 1, max: -1, fn: Math.max, args: 'a, b, …' },
  rad: {
    min: 1,
    max: 1,
    fn: (degrees) => (degrees * Math.PI) / 180,
    args: 'degrees',
  },
  deg: {
    min: 1,
    max: 1,
    fn: (radians) => (radians * 180) / Math.PI,
    args: 'radians',
  },
};

/** Names a variable can't have: the constants and functions. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(CONSTANTS),
  ...Object.keys(FUNCTIONS),
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isIdentifier(name: string): boolean {
  return IDENTIFIER.test(name);
}

/** A plain number as typed ("12", "-0.5", "1e3"), not an expression. */
const PLAIN_NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

export function isPlainNumber(text: string): boolean {
  return PLAIN_NUMBER.test(text);
}

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'name'; name: string; at: number }
  | { kind: 'op'; op: string; at: number }
  | { kind: 'end'; at: number };

const NUMBER = String.raw`(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const UNIT = String.raw`\s*(?<unit>${Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join('|')})(?![A-Za-z0-9_])`;
const TOKEN = new RegExp(
  String.raw`\s*(?:(?<over>\d+)\s*\/\s*(?<under>\d+)(?=${UNIT.replace('?<unit>', '?:')})|(?<number>${NUMBER})|(?<name>[A-Za-z_][A-Za-z0-9_]*)|(?<op>\*\*|[-+*/%^(),]))`,
  'y',
);
const UNIT_AFTER = new RegExp(UNIT, 'y');

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) {
      break;
    }
    TOKEN.lastIndex = at;
    const match = TOKEN.exec(text);
    if (!match) {
      const bad = text.slice(at).trimStart()[0];
      throw new ExpressionError(`unexpected “${bad}”`);
    }
    const { over, under, number, name, op } = match.groups!;
    const start = at + match[0].length - match[0].trimStart().length;
    at = TOKEN.lastIndex;
    if (over !== undefined || number !== undefined) {
      let value = number !== undefined ? Number(number) : +over / +under;
      UNIT_AFTER.lastIndex = at;
      const unit = UNIT_AFTER.exec(text);
      if (unit) {
        value *= UNITS[unit.groups!['unit']];
        at = UNIT_AFTER.lastIndex;
      }
      tokens.push({ kind: 'number', value, at: start });
    } else if (name !== undefined) {
      tokens.push({ kind: 'name', name, at: start });
    } else {
      tokens.push({ kind: 'op', op: op === '**' ? '^' : op, at: start });
    }
  }
  tokens.push({ kind: 'end', at: text.length });
  return tokens;
}

/**
 * The value of `text`, with `variables` by name. Throws an
 * `ExpressionError` saying what's wrong.
 */
export function evaluateExpression(
  text: string,
  variables: ReadonlyMap<string, number>,
): number {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (op: string) => {
    const token = tokens[i];
    return token.kind === 'op' && token.op === op;
  };
  const describe = (token: Token) =>
    token.kind === 'end'
      ? 'the end'
      : `“${token.kind === 'number' ? token.value : token.kind === 'name' ? token.name : token.op}”`;
  const expect = (op: string) => {
    if (!isOp(op)) {
      throw new ExpressionError(
        `expected “${op}” but found ${describe(peek())}`,
      );
    }
    i++;
  };

  // sum := product (("+" | "-") product)*
  const sum = (): number => {
    let value = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[i++] as { op: string }).op;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  // product := unary (("*" | "/" | "%") unary)*
  const product = (): number => {
    let value = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (tokens[i++] as { op: string }).op;
      const right = unary();
      value =
        op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  };

  // unary := ("-" | "+") unary | power      (so -2^2 is -4)
  const unary = (): number => {
    if (isOp('-')) {
      i++;
      return -unary();
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    return power();
  };

  // power := primary ("^" unary)?           (right-associative)
  const power = (): number => {
    const base = primary();
    if (isOp('^')) {
      i++;
      return Math.pow(base, unary());
    }
    return base;
  };

  const primary = (): number => {
    const token = tokens[i];
    if (token.kind === 'number') {
      i++;
      // A name right after a number (and not a call) is meant as its unit.
      const next = peek();
      const after = tokens[i + 1];
      if (next.kind === 'name' && !(after.kind === 'op' && after.op === '(')) {
        throw new ExpressionError(
          `unknown unit “${next.name}” (${Object.keys(UNITS).join(', ')})`,
        );
      }
      return token.value;
    }
    if (token.kind === 'name') {
      i++;
      if (isOp('(')) {
        return call(token.name);
      }
      const value = variables.get(token.name) ?? CONSTANTS[token.name];
      if (value === undefined) {
        throw new ExpressionError(
          FUNCTIONS[token.name]
            ? `${token.name} is a function: ${token.name}(…)`
            : `unknown variable “${token.name}”`,
          FUNCTIONS[token.name] ? undefined : token.name,
        );
      }
      return value;
    }
    if (isOp('(')) {
      i++;
      const value = sum();
      expect(')');
      return value;
    }
    throw new ExpressionError(
      token.kind === 'end'
        ? 'incomplete expression'
        : `unexpected ${describe(token)}`,
    );
  };

  const call = (name: string): number => {
    const fn = FUNCTIONS[name];
    if (!fn) {
      throw new ExpressionError(`unknown function “${name}”`);
    }
    expect('(');
    const args: number[] = [];
    if (!isOp(')')) {
      args.push(sum());
      while (isOp(',')) {
        i++;
        args.push(sum());
      }
    }
    expect(')');
    if (args.length < fn.min || (fn.max >= 0 && args.length > fn.max)) {
      const count =
        fn.max < 0
          ? `at least ${fn.min}`
          : `${fn.min}${fn.max !== fn.min ? `–${fn.max}` : ''}`;
      throw new ExpressionError(
        `${name} takes ${count} argument${fn.min === 1 && fn.max === 1 ? '' : 's'}`,
      );
    }
    return fn.fn(...args);
  };

  if (peek().kind === 'end') {
    throw new ExpressionError('empty expression');
  }
  const value = sum();
  if (peek().kind !== 'end') {
    throw new ExpressionError(`unexpected ${describe(peek())}`);
  }
  if (!Number.isFinite(value)) {
    throw new ExpressionError(
      Number.isNaN(value) ? 'not a number' : 'infinite (division by zero?)',
    );
  }
  return value;
}
