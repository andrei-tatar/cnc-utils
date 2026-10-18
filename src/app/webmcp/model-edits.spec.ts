import { emptyModel, ModelType } from '../model-editor/model';
import {
  FilePlaceholders,
  findItem,
  insertItems,
  moveItem,
  referencesTo,
  removeItems,
  updateItem,
  updateSection,
} from './model-edits';

function project(): ModelType {
  return {
    ...emptyModel(),
    shapes: [
      {
        id: 's1',
        type: 'circle',
        diameter: 20,
        expanded: false,
        transforms: [{ id: 't1', type: 'translate', x: 5, y: 0 }],
      },
      { id: 's2', type: 'circle', diameter: 30, expanded: false },
    ],
    tools: [{ id: 'k1', diameter: 6, bitType: 'end-mill', index: 1 }],
    operations: [
      { id: 'o1', type: 'profile', shapeId: 's1', toolId: 'k1' },
      {
        id: 'r1',
        type: 'rotary-repeat',
        operations: [{ id: 'o2', type: 'pocket', shapeId: 's2' }],
      },
    ],
  } as unknown as ModelType;
}

describe('model edits', () => {
  it('finds items in nested lists', () => {
    const model = project();
    expect(findItem(model, 't1')?.path).toBe('shapes[0].transforms');
    expect(findItem(model, 'o2')?.path).toBe('operations[1].operations');
    expect(findItem(model, 'nope')).toBeNull();
  });

  it('changes an item without touching the original', () => {
    const model = project();
    const changed = updateItem(model, 't1', { x: '2 * a', y: null });
    expect(findItem(changed, 't1')?.item).toEqual({
      id: 't1',
      type: 'translate',
      x: '2 * a',
    });
    expect(findItem(model, 't1')?.item['x']).toBe(5);
    expect(() => updateItem(model, 't1', { id: 'other' })).toThrow();
    expect(() => updateItem(model, 'missing', {})).toThrow();
  });

  it('changes settings', () => {
    const changed = updateSection(project(), 'stock', { thickness: 12 });
    expect(changed.stock.thickness).toBe(12);
  });

  it('removes and moves items', () => {
    const model = project();
    const removed = removeItems(model, ['s2', 't1']);
    expect(removed.shapes.map((s) => s.id)).toEqual(['s1']);
    expect(removed.shapes[0].transforms).toEqual([]);
    expect(() => removeItems(model, ['missing'])).toThrow();

    expect(moveItem(model, 's1', { after: 's2' }).shapes[1].id).toBe('s1');
    expect(moveItem(model, 's2', { index: 0 }).shapes[0].id).toBe('s2');
    expect(() => moveItem(model, 's1', { before: 'k1' })).toThrow();
  });

  it('inserts items at the top or in an item', () => {
    const model = project();
    const top = insertItems(model, { list: 'shapes', index: 0 }, [
      { id: 'n', type: 'rectangle' },
    ]);
    expect(top.shapes.map((s) => s.id)).toEqual(['n', 's1', 's2']);
    const nested = insertItems(model, { list: 'transforms', parentId: 's2' }, [
      { id: 'n', type: 'rotate' },
    ]);
    expect(findItem(nested, 'n')?.path).toBe('shapes[1].transforms');
    expect(() => insertItems(model, { list: 'nothing' }, [])).toThrow();
  });

  it('finds what refers to items', () => {
    const references = referencesTo(project(), ['s2', 'k1']);
    expect(references).toEqual([
      { id: 'k1', itemId: 'o1', key: 'toolId' },
      { id: 's2', itemId: 'o2', key: 'shapeId' },
    ]);
    // Not from inside an item being removed.
    expect(referencesTo(project(), ['s1', 'o1'])).toEqual([]);
  });

  it('stands in for long files and puts them back', () => {
    const files = new FilePlaceholders();
    const svg = '<svg>' + 'x'.repeat(5000) + '</svg>';
    const short = files.abbreviate({ shapes: [{ svg, name: 'a' }] });
    expect(short.shapes[0].svg.length).toBeLessThan(200);
    expect(short.shapes[0].name).toBe('a');
    expect(files.restore(short)).toEqual({ shapes: [{ svg, name: 'a' }] });
    // The same file, the same placeholder.
    expect(files.abbreviate(svg)).toBe(short.shapes[0].svg);
  });
});
