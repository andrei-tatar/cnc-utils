import { TextStyleType, withTextStyle } from '.';

describe('text styles', () => {
  const font = { id: 'roboto', family: 'Roboto', version: '5.2.10' } as any;
  const style: TextStyleType = {
    id: 'id-y',
    expanded: false,
    name: 'labels',
    font,
    fontWeight: 700,
    fontStyle: 'italic',
    size: 12,
    letterSpacing: 1,
    lineSpacing: 1.5,
    align: 'center',
  };
  const settings = {
    font,
    fontWeight: 700,
    fontStyle: 'italic',
    size: 12,
    letterSpacing: 1,
    lineSpacing: 1.5,
    align: 'center',
  };

  it('sets a text shape in its style', () => {
    expect(
      withTextStyle({ type: 'text', text: 'ASD', textStyleId: 'id-y' } as any, [
        style,
      ]),
    ).toEqual({ type: 'text', text: 'ASD', ...settings });
  });

  it('takes the shape’s cap height over the style’s', () => {
    const shape = { type: 'text', textStyleId: 'id-y', sizeOverride: 30 };
    expect(withTextStyle(shape as any, [style]).size).toBe(30);
    // Empty, or what can't be worked out: the style's.
    for (const sizeOverride of [null, undefined, 0]) {
      expect(
        withTextStyle({ ...shape, sizeOverride } as any, [style]).size,
      ).toBe(12);
    }
  });

  it('leaves a shape with its own settings as it is', () => {
    const own = { type: 'text', text: 'A', ...settings, size: 5 };
    expect(
      withTextStyle({ ...own, textStyleId: null } as any, [style]),
    ).toEqual(own);
    const circle = { type: 'circle', diameter: 3 };
    expect(withTextStyle(circle, [style])).toBe(circle);
  });

  it('gives a shape whose style is gone no font', () => {
    const shape = { type: 'text', text: 'A', textStyleId: 'gone' };
    expect(withTextStyle(shape as any, [style]).font).toBeUndefined();
  });
});
