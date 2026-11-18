import { entryFor, LibraryEntry } from '../model-editor/tools/tool-library';
import { toolsIn } from './cloud-projects.service';

const tool = (name: string, diameter = 6) =>
  ({ name, type: 'end-mill', diameter }) as any;

describe('the tool library in Firebase', () => {
  it('reads stored tools by name, leaving out what isn’t one', () => {
    const tools = toolsIn({
      b: { tool: JSON.stringify(tool('Zebra')), savedAt: 2 },
      a: { tool: JSON.stringify(tool('Alpha')), savedAt: 1 },
      c: { tool: 'not json', savedAt: 3 },
      d: { savedAt: 4 },
    });
    expect(tools.map((entry) => [entry.key, entry.tool.name])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Zebra'],
    ]);
    expect(toolsIn(null)).toEqual([]);
  });

  it('keeps a tool in place of the one with its name', async () => {
    const entries: LibraryEntry[] = [
      { key: 'a', tool: tool('Alpha'), savedAt: 1 },
    ];
    const replaced = await entryFor(entries, {
      ...tool('Alpha', 3),
      id: 'x',
      expanded: true,
    });
    expect(replaced.key).toBe('a');
    expect(replaced.tool).toEqual(tool('Alpha', 3));
    expect((await entryFor(entries, tool('Beta'))).key).not.toBe('a');
  });
});
