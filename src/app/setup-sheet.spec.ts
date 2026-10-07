import { DEFAULT_GCODE_OPTIONS } from '../cam/gcode-options';
import { DEFAULT_STOCK } from '../cam/stock';
import { duration, setupSheetHtml } from './setup-sheet';

describe('setup sheet', () => {
  it('writes durations readably', () => {
    expect(duration(35)).toBe('35 s');
    expect(duration(250)).toBe('4 min 10 s');
    expect(duration(3900)).toBe('1 h 05 min');
  });

  it('lists the stock, zero, tools in order and notes', () => {
    const html = setupSheetHtml({
      title: 'Sign <1>',
      date: new Date(2026, 0, 2),
      stock: { ...DEFAULT_STOCK, enabled: true, xyZero: 'xmin-ymin' },
      zero: { x: 0, y: 0, z: 0 },
      options: DEFAULT_GCODE_OPTIONS,
      operations: [
        { id: 'a', name: 'pocket', tool: 'T1 Ø6 mm end mill', seconds: 60 },
        { id: 'b', name: 'v-carve', tool: 'T2 Ø20 mm 60° v-bit', seconds: 30 },
        { id: 'c', name: 'profile', tool: 'T1 Ø6 mm end mill', seconds: 90 },
      ],
      total: 180,
      shapes: [
        {
          sourceShapeId: 's',
          polygons: [
            {
              vertices: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
              ],
              close: true,
            },
          ],
        },
      ],
      paths: [],
      notes: ['Clamp “left” is crossed by profile'],
    });
    expect(html).toContain('Sign &lt;1&gt;');
    expect(html).toContain('200 × 150 × 18 mm');
    expect(html).toContain('the stock’s bottom-left corner');
    expect(html.indexOf('T1 Ø6 mm end mill')).toBeLessThan(
      html.indexOf('T2 Ø20 mm 60° v-bit'),
    );
    // T1 again after T2: fitted again, so listed again.
    expect(html.match(/<td>T1 Ø6 mm end mill<\/td><td>/g)?.length).toBe(2);
    expect(html).toContain('Clamp “left” is crossed by profile');
    expect(html).toContain('<svg');
  });
});
