import { operationInputs } from '../../pipeline/operation-inputs';
import { freeToolIndex, numberedToolLabel, toolNumber, ToolType } from '.';

describe('tool index', () => {
  const tool = (id: string, index?: number): ToolType =>
    ({ id, diameter: 3, ...(index === undefined ? {} : { index }) }) as any;

  it('numbers the tool in the G-code, whatever its place in the list', () => {
    const tools = [tool('a', 5), tool('b', 2)];
    const inputs = operationInputs(
      { id: 'o', type: 'pocket', toolId: 'b', shapeId: 's' } as any,
      { tools, operations: [] },
    );
    expect(inputs.toolInfo?.number).toBe(2);
    expect(inputs.toolParameters as any).not.toEqual(
      jasmine.objectContaining({ index: jasmine.anything() }),
    );
  });

  it('falls back to the place in the list for a tool without one', () => {
    const tools = [tool('a', 5), tool('b')];
    expect(toolNumber(tools[1], tools)).toBe(2);
  });

  it('for a new tool is the lowest free one', () => {
    expect(freeToolIndex([])).toBe(1);
    expect(freeToolIndex([tool('a', 1), tool('b', 3)])).toBe(2);
  });

  it('shows in the tool’s name', () => {
    expect(numberedToolLabel({ ...tool('a', 4), name: 'roughing' })).toBe(
      'T4 roughing',
    );
    expect(numberedToolLabel({ ...tool('a'), name: 'roughing' })).toBe(
      'roughing',
    );
  });
});
