import { parsePathData, pathCommandsData } from './path-commands';

describe('parsePathData', () => {
  it('reads each command with its numbers', () => {
    expect(parsePathData('M 0,0 L100,0 H 50 v-20 Z')).toEqual({
      commands: [
        { command: 'M', x: 0, y: 0 },
        { command: 'L', x: 100, y: 0 },
        { command: 'H', x: 50 },
        { command: 'v', y: -20 },
        { command: 'Z' },
      ],
    });
  });

  it('reads curves and arcs', () => {
    expect(
      parsePathData('M0 0C1 2 3 4 5 6q1 1 2 2A5 6 30 1 0 10 0').commands,
    ).toEqual([
      { command: 'M', x: 0, y: 0 },
      { command: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { command: 'q', x1: 1, y1: 1, x: 2, y: 2 },
      {
        command: 'A',
        rx: 5,
        ry: 6,
        rotation: 30,
        largeArc: true,
        sweep: false,
        x: 10,
        y: 0,
      },
    ]);
  });

  it('reads numbers and arc flags run together', () => {
    expect(parsePathData('M1-2.5.5.5L1e1-1e-1a5 5 0 1010 0').commands).toEqual([
      { command: 'M', x: 1, y: -2.5 },
      { command: 'L', x: 0.5, y: 0.5 },
      { command: 'L', x: 10, y: -0.1 },
      {
        command: 'a',
        rx: 5,
        ry: 5,
        rotation: 0,
        largeArc: true,
        sweep: false,
        x: 10,
        y: 0,
      },
    ]);
  });

  it('repeats a command whose letter is left out, lines after a move', () => {
    expect(parsePathData('m 1 1 2 2 L 3 3 4 4 z').commands).toEqual([
      { command: 'm', x: 1, y: 1 },
      { command: 'l', x: 2, y: 2 },
      { command: 'L', x: 3, y: 3 },
      { command: 'L', x: 4, y: 4 },
      { command: 'Z' },
    ]);
  });

  it('says what is wrong and where', () => {
    const parsed = parsePathData('M 0 0 L 10 x');
    expect('error' in parsed && parsed.position).toBe(11);
    expect(parsed.commands).toEqual([{ command: 'M', x: 0, y: 0 }]);
    expect('error' in parsePathData('L 0 0')).toBeTrue();
    expect('error' in parsePathData('M 0 0 K 1')).toBeTrue();
    expect('error' in parsePathData('M 0 0 L 1')).toBeTrue();
    expect('error' in parsePathData('M 0 0 Z 1 1')).toBeTrue();
  });

  it('takes empty text as no commands', () => {
    expect(parsePathData('  ')).toEqual({ commands: [] });
  });
});

describe('pathCommandsData', () => {
  it('writes the commands back as path data', () => {
    const text = 'M 0 0 C 1 2 3 4 5 6 a 5 5 0 1 0 10 0 h 3 Z';
    expect(pathCommandsData(parsePathData(text).commands)).toBe(text);
  });

  it('stops at a number that cannot be worked out', () => {
    expect(
      pathCommandsData([
        { command: 'M', x: 0, y: 0 },
        { command: 'l', x: null as any, y: 1 },
        { command: 'L', x: 5, y: 5 },
      ]),
    ).toBe('M 0 0');
  });
});
