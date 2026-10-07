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

type Token = { at: number; end: number } & (
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'end' }
);

/** A parsed expression: each part with where it is in the text. */
type Node = { from: number; to: number } & (
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'group'; inner: Node }
);

/** A token (from `at` to `end`) and the part of the expression it makes. */
type Part = { at: number; end: number; node: Node };

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
      tokens.push({ kind: 'number', value, at: start, end: at });
    } else if (name !== undefined) {
      tokens.push({ kind: 'name', name, at: start, end: at });
    } else {
      tokens.push({
        kind: 'op',
        op: op === '**' ? '^' : op,
        at: start,
        end: at,
      });
    }
  }
  tokens.push({ kind: 'end', at: text.length, end: text.length });
  return tokens;
}

/**
 * Reads `text` into its parts (every token belongs to one: an operator to
 * its operation, a function's name, brackets and commas to its call).
 * Throws an `ExpressionError` when it can't be read.
 */
function parse(text: string): { root: Node; parts: Part[] } {
  const tokens = tokenize(text);
  const parts: Part[] = [];
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (op: string) => {
    const token = tokens[i];
    return token.kind === 'op' && token.op === op;
  };
  const own = (token: Token, node: Node) =>
    parts.push({ at: token.at, end: token.end, node });
  const describe = (token: Token) =>
    token.kind === 'end'
      ? 'the end'
      : `“${token.kind === 'number' ? token.value : token.kind === 'name' ? token.name : token.op}”`;
  const expect = (op: string): Token => {
    if (!isOp(op)) {
      throw new ExpressionError(
        `expected “${op}” but found ${describe(peek())}`,
      );
    }
    return tokens[i++];
  };

  // Left-associative operators, e.g. sum := product (("+" | "-") product)*
  const binary = (ops: string[], operand: () => Node) => (): Node => {
    let node = operand();
    while (ops.some(isOp)) {
      const token = tokens[i++] as Token & { op: string };
      const right = operand();
      node = {
        kind: 'binary',
        op: token.op,
        left: node,
        right,
        from: node.from,
        to: right.to,
      };
      own(token, node);
    }
    return node;
  };

  // unary := ("-" | "+") unary | power      (so -2^2 is -4)
  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const token = tokens[i++] as Token & { op: string };
      const arg = unary();
      const node: Node = {
        kind: 'unary',
        op: token.op,
        arg,
        from: token.at,
        to: arg.to,
      };
      own(token, node);
      return node;
    }
    return power();
  };

  // power := primary ("^" unary)?           (right-associative)
  const power = (): Node => {
    const base = primary();
    if (!isOp('^')) {
      return base;
    }
    const token = tokens[i++];
    const exponent = unary();
    const node: Node = {
      kind: 'binary',
      op: '^',
      left: base,
      right: exponent,
      from: base.from,
      to: exponent.to,
    };
    own(token, node);
    return node;
  };

  const primary = (): Node => {
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
      const node: Node = {
        kind: 'number',
        value: token.value,
        from: token.at,
        to: token.end,
      };
      own(token, node);
      return node;
    }
    if (token.kind === 'name') {
      i++;
      return isOp('(') ? call(token) : leaf(token);
    }
    if (isOp('(')) {
      const open = tokens[i++];
      const inner = sum();
      const close = expect(')');
      const node: Node = {
        kind: 'group',
        inner,
        from: open.at,
        to: close.end,
      };
      own(open, node);
      own(close, node);
      return node;
    }
    throw new ExpressionError(
      token.kind === 'end'
        ? 'incomplete expression'
        : `unexpected ${describe(token)}`,
    );
  };

  const leaf = (token: Token & { name: string }): Node => {
    const node: Node = {
      kind: 'name',
      name: token.name,
      from: token.at,
      to: token.end,
    };
    own(token, node);
    return node;
  };

  const call = (name: Token & { name: string }): Node => {
    const punctuation = [name, expect('(')];
    const args: Node[] = [];
    if (!isOp(')')) {
      args.push(sum());
      while (isOp(',')) {
        punctuation.push(tokens[i++]);
        args.push(sum());
      }
    }
    const close = expect(')');
    punctuation.push(close);
    const node: Node = {
      kind: 'call',
      name: name.name,
      args,
      from: name.at,
      to: close.end,
    };
    punctuation.forEach((token) => own(token, node));
    return node;
  };

  const product = binary(['*', '/', '%'], unary);
  const sum = binary(['+', '-'], product);

  if (peek().kind === 'end') {
    throw new ExpressionError('empty expression');
  }
  const root = sum();
  if (peek().kind !== 'end') {
    throw new ExpressionError(`unexpected ${describe(peek())}`);
  }
  return { root, parts };
}

/** What a part of an expression works out to. */
function evaluate(node: Node, variables: ReadonlyMap<string, number>): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'name': {
      const { name } = node;
      const value =
        variables.get(name) ??
        (Object.hasOwn(CONSTANTS, name) ? CONSTANTS[name] : undefined);
      if (value === undefined) {
        const isFunction = Object.hasOwn(FUNCTIONS, name);
        throw new ExpressionError(
          isFunction
            ? `${name} is a function: ${name}(…)`
            : `unknown variable “${name}”`,
          isFunction ? undefined : name,
        );
      }
      return value;
    }
    case 'call': {
      const { name, args } = node;
      const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
      if (!fn) {
        throw new ExpressionError(`unknown function “${name}”`);
      }
      if (args.length < fn.min || (fn.max >= 0 && args.length > fn.max)) {
        const count =
          fn.max < 0
            ? `at least ${fn.min}`
            : `${fn.min}${fn.max !== fn.min ? `–${fn.max}` : ''}`;
        throw new ExpressionError(
          `${name} takes ${count} argument${fn.min === 1 && fn.max === 1 ? '' : 's'}`,
        );
      }
      return fn.fn(...args.map((arg) => evaluate(arg, variables)));
    }
    case 'unary': {
      const value = evaluate(node.arg, variables);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluate(node.left, variables);
      const right = evaluate(node.right, variables);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        default:
          return Math.pow(left, right);
      }
    }
    case 'group':
      return evaluate(node.inner, variables);
  }
}

/**
 * The value of `text`, with `variables` by name. Throws an
 * `ExpressionError` saying what's wrong.
 */
export function evaluateExpression(
  text: string,
  variables: ReadonlyMap<string, number>,
): number {
  const value = evaluate(parse(text).root, variables);
  if (!Number.isFinite(value)) {
    throw new ExpressionError(
      Number.isNaN(value) ? 'not a number' : 'infinite (division by zero?)',
    );
  }
  return value;
}

/**
 * A token of an expression (from `at` to `end` in the text), the part it
 * makes (from `from` to `to`: `sqrt(a)` for `sqrt` and its brackets, `a * 2`
 * for the `*`) and what that part works out to, or why it doesn't.
 */
export type Explained = {
  at: number;
  end: number;
  from: number;
  to: number;
} & ({ value: number } | { error: ExpressionError });

/**
 * What each token of `text` works out to, for showing it. When the text
 * can't be read as a whole, only the numbers and names are explained.
 */
export function explainExpression(
  text: string,
  variables: ReadonlyMap<string, number>,
): Explained[] {
  let parts: Part[];
  try {
    parts = parse(text).parts;
  } catch (e) {
    if (!(e instanceof ExpressionError)) throw e;
    parts = leaves(text);
  }
  const results = new Map<
    Node,
    { value: number } | { error: ExpressionError }
  >();
  return parts.map(({ at, end, node }) => {
    let result = results.get(node);
    if (!result) {
      try {
        result = { value: evaluate(node, variables) };
      } catch (e) {
        if (!(e instanceof ExpressionError)) throw e;
        result = { error: e };
      }
      results.set(node, result);
    }
    return { at, end, from: node.from, to: node.to, ...result };
  });
}

/** The numbers and names of text that can't be parsed, each on its own. */
function leaves(text: string): Part[] {
  let tokens: Token[];
  try {
    tokens = tokenize(text);
  } catch (e) {
    if (!(e instanceof ExpressionError)) throw e;
    return [];
  }
  return tokens.flatMap((token): Part[] => {
    const at = token.at;
    const end = token.end;
    if (token.kind === 'number') {
      return [
        {
          at,
          end,
          node: { kind: 'number', value: token.value, from: at, to: end },
        },
      ];
    }
    if (token.kind === 'name') {
      return [
        {
          at,
          end,
          node: { kind: 'name', name: token.name, from: at, to: end },
        },
      ];
    }
    return [];
  });
}
