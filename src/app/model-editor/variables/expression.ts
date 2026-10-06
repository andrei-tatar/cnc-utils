/**
 * Arithmetic expressions for number fields, e.g. `sqrt(2) * width / 2`.
 *
 * Numbers, variables, `+ - * / %`, `^` (or `**`) for powers, parentheses
 * and the functions below. Angles are in radians (`rad(45)`, `deg(x)`
 * convert). Parsed by hand: nothing is ever `eval`ed.
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

const CONSTANTS: Record<string, number> = { pi: Math.PI };

/** Functions, and how many arguments they take (`max` of -1: any). */
const FUNCTIONS: Record<
  string,
  { min: number; max: number; fn: (...args: number[]) => number }
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
  atan2: { min: 2, max: 2, fn: Math.atan2 },
  exp: { min: 1, max: 1, fn: Math.exp },
  ln: { min: 1, max: 1, fn: Math.log },
  log: { min: 1, max: 1, fn: Math.log10 },
  log2: { min: 1, max: 1, fn: Math.log2 },
  pow: { min: 2, max: 2, fn: Math.pow },
  hypot: { min: 1, max: -1, fn: Math.hypot },
  min: { min: 1, max: -1, fn: Math.min },
  max: { min: 1, max: -1, fn: Math.max },
  rad: { min: 1, max: 1, fn: (degrees) => (degrees * Math.PI) / 180 },
  deg: { min: 1, max: 1, fn: (radians) => (radians * 180) / Math.PI },
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

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/%^(),]))/y;
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) {
      break;
    }
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match) {
      const bad = text.slice(at).trimStart()[0];
      throw new ExpressionError(`unexpected “${bad}”`);
    }
    const start =
      at + match[0].length - (match[1] ?? match[2] ?? match[3]).length;
    if (match[1] !== undefined) {
      tokens.push({ kind: 'number', value: Number(match[1]), at: start });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: 'name', name: match[2], at: start });
    } else {
      tokens.push({
        kind: 'op',
        op: match[3] === '**' ? '^' : match[3],
        at: start,
      });
    }
    at = pattern.lastIndex;
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
