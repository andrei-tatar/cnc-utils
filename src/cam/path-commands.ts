/**
 * SVG path data as a list of commands, one per drawing instruction, so
 * each parameter can be edited (and be an expression) on its own.
 */

/** The command letter: upper case moves to a point, lower case by an offset. */
export type PathCommandLetter =
  | 'M'
  | 'm'
  | 'L'
  | 'l'
  | 'H'
  | 'h'
  | 'V'
  | 'v'
  | 'C'
  | 'c'
  | 'S'
  | 's'
  | 'Q'
  | 'q'
  | 'T'
  | 't'
  | 'A'
  | 'a'
  | 'Z';

/** A command's numbers, by name. */
export type PathParameter =
  'x' | 'y' | 'x1' | 'y1' | 'x2' | 'y2' | 'rx' | 'ry' | 'rotation';

/** An arc's two flags. */
export type PathFlag = 'largeArc' | 'sweep';

export type PathCommand = {
  command: PathCommandLetter;
} & Partial<Record<PathParameter, number>> &
  Partial<Record<PathFlag, boolean>>;

/** What each command takes, in the order path data lists it. */
export const PATH_COMMAND_PARAMETERS: Record<
  Uppercase<PathCommandLetter>,
  ReadonlyArray<PathParameter | PathFlag>
> = {
  M: ['x', 'y'],
  L: ['x', 'y'],
  H: ['x'],
  V: ['y'],
  C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'],
  S: ['x2', 'y2', 'x', 'y'],
  Q: ['x1', 'y1', 'x', 'y'],
  T: ['x', 'y'],
  A: ['rx', 'ry', 'rotation', 'largeArc', 'sweep', 'x', 'y'],
  Z: [],
};

export function parametersOf(
  command: string | undefined,
): ReadonlyArray<PathParameter | PathFlag> {
  return (
    PATH_COMMAND_PARAMETERS[
      (command ?? '').toUpperCase() as Uppercase<PathCommandLetter>
    ] ?? []
  );
}

const isFlag = (name: string): name is PathFlag =>
  name === 'largeArc' || name === 'sweep';

export type PathDataParse =
  | { commands: PathCommand[] }
  | {
      /** The commands read before the error. */
      commands: PathCommand[];
      error: string;
      /** Where in the text the error is. */
      position: number;
    };

/**
 * Read SVG path data ("M 0,0 L 10 0 …") into commands, as the SVG grammar
 * has it: numbers may run together ("1-2", "0.5.5"), arc flags may too
 * ("a5 5 0 1010 0"), and a command's letter may be left out when it
 * repeats (after a move, the repeats are lines).
 */
export function parsePathData(text: string): PathDataParse {
  const commands: PathCommand[] = [];
  let i = 0;

  const fail = (error: string, position = i): PathDataParse => ({
    commands,
    error,
    position,
  });
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const skipSeparator = () => {
    skipSpace();
    if (text[i] === ',') {
      i++;
      skipSpace();
    }
  };
  const readNumber = (): number | null => {
    const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) return null;
    i += match[0].length;
    return Number(match[0]);
  };
  const readFlag = (): boolean | null => {
    if (text[i] !== '0' && text[i] !== '1') return null;
    return text[i++] === '1';
  };
  const describe = (letter: string) =>
    `“${letter}” takes ${parametersOf(letter).length} numbers`;

  skipSpace();
  let letter: string | null = null;
  while (i < text.length) {
    const start = i;
    if (/[a-zA-Z]/.test(text[i])) {
      letter = text[i++];
      if (!(letter.toUpperCase() in PATH_COMMAND_PARAMETERS)) {
        return fail(`“${letter}” isn't a path command`, start);
      }
      if (!commands.length && letter.toUpperCase() !== 'M') {
        return fail('Path data starts with a move (M or m)', start);
      }
      skipSpace();
    } else if (letter === null) {
      return fail('Path data starts with a move (M or m)', start);
    } else if (letter.toUpperCase() === 'Z') {
      return fail('“Z” takes no numbers', start);
    } else if (letter === 'M') {
      // Pairs after a move's first one are lines.
      letter = 'L';
    } else if (letter === 'm') {
      letter = 'l';
    }

    const command = (
      letter.toUpperCase() === 'Z' ? 'Z' : letter
    ) as PathCommandLetter;
    const parsed: PathCommand = { command };
    const names = parametersOf(command);
    for (const [k, name] of names.entries()) {
      if (k > 0) skipSeparator();
      const at = i;
      const value = isFlag(name) ? readFlag() : readNumber();
      if (value === null) {
        return fail(
          i >= text.length
            ? `${describe(letter)}: the path data ends too soon`
            : `${describe(letter)}: “${text[at]}” isn't ${
                isFlag(name) ? 'a flag (0 or 1)' : 'a number'
              }`,
          at,
        );
      }
      (parsed as Record<string, unknown>)[name] = value;
    }
    commands.push(parsed);
    skipSeparator();
  }
  return { commands };
}

/**
 * The commands as path data. It stops at a command with a number that
 * can't be worked out (an expression resolved to `null`), like a browser
 * stops drawing at an error: leaving it out would move everything drawn
 * relative to it.
 */
export function pathCommandsData(
  commands:
    ReadonlyArray<Partial<PathCommand> | null | undefined> | null | undefined,
): string {
  const parts: string[] = [];
  for (const c of Array.isArray(commands) ? commands : []) {
    const command = c?.command;
    if (!command || !(command.toUpperCase() in PATH_COMMAND_PARAMETERS)) {
      break;
    }
    const values: string[] = [];
    for (const name of parametersOf(command)) {
      const value = c[name];
      if (isFlag(name)) {
        values.push(value ? '1' : '0');
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        values.push(String(value));
      } else {
        return parts.join(' ');
      }
    }
    parts.push([command, ...values].join(' '));
  }
  return parts.join(' ');
}
