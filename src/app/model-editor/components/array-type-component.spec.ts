import { withNewIds } from './array-type-component';

describe('copying a list item', () => {
  it('gives the item and the items of its lists new ids, nothing else', async () => {
    const font = { id: 'roboto', family: 'Roboto', version: '5.2.10' };
    const shape = {
      id: 'id-s1',
      type: 'text',
      text: 'ASD',
      font,
      transforms: [
        { id: 'id-t1', type: 'translate', translateX: 0 },
        { id: 'id-t2', type: 'tabs', tabPoints: [{ id: 'id-p1', x: 1 }] },
      ],
    };

    const copy = await withNewIds(structuredClone(shape));

    expect(copy.id).not.toBe('id-s1');
    expect(copy.transforms[0].id).not.toBe('id-t1');
    expect(copy.transforms[1].id).not.toBe('id-t2');
    expect(copy.transforms[1].tabPoints[0].id).not.toBe('id-p1');
    expect(copy.font).toEqual(font);
    expect(copy.text).toBe('ASD');
  });
});
