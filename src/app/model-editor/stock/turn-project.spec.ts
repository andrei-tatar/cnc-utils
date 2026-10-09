import { emptyModel, ModelType } from '../model';
import { resolveStock } from '../../../cam/stock';
import { turnProject } from './turn-project';

describe('turning a project with the rotary axis', () => {
  let n = 0;
  const newId = async () => `id${++n}`;
  const model = (): ModelType =>
    ({
      ...emptyModel(),
      shapes: [
        { id: 'r', type: 'rectangle', width: 10, height: 20, transforms: [] },
        {
          id: 'c',
          type: 'copy',
          copyOfId: 'r',
          transforms: [{ id: 't', type: 'translate', translateX: 5 }],
        },
      ],
      operations: [
        { id: 'p', type: 'pocket', alongAxis: 'y' },
        {
          id: 'e',
          type: 'image-engrave',
          imageRotation: 0,
          rasterAngle: 45,
          imageAlignX: 'left',
          imageAlignY: 'top',
          imageOffsetX: 3,
          imageOffsetY: 'a * 2',
        },
        {
          id: 'rep',
          type: 'rotary-repeat',
          operations: [{ id: 'f', type: 'flat', alongAxis: 'x' }],
        },
      ],
      stock: resolveStock({
        enabled: true,
        mount: 'rotary',
        rotaryAlong: 'y',
        width: 40,
        height: 200,
        thickness: 40,
        x: 10,
        y: 'start' as any,
        xyZero: 'xmin-ymax',
      }),
    }) as any;

  it('turns the stock: its length along X now, its corner where it goes', async () => {
    const turned = await turnProject(model(), 'y', 'x', newId);
    // Clockwise, (x, y) → (y, −x): X from Y, Y from −(X + width).
    expect(turned.stock).toEqual(
      jasmine.objectContaining({
        rotaryAlong: 'x',
        width: 200,
        height: 40,
        x: 'start' as any,
        y: -50,
        // The top-left corner (xmin, ymax) goes to xmax, ymax.
        xyZero: 'xmax-ymax',
      }),
    );
  });

  it('turns shapes last, and those made from others back first', async () => {
    const turned: any = await turnProject(model(), 'y', 'x', newId);
    const [r, c] = turned.shapes;
    expect(r.transforms.map((t: any) => [t.type, t.rotateAngle])).toEqual([
      ['rotate', 90],
    ]);
    expect(c.transforms.map((t: any) => [t.type, t.rotateAngle])).toEqual([
      ['rotate', -90],
      ['translate', undefined],
      ['rotate', 90],
    ]);
    expect(r.transforms[0]).toEqual(
      jasmine.objectContaining({ around: 'point', aroundX: 0, aroundY: 0 }),
    );
  });

  it('turns directions and images, inside rotary repeats too', async () => {
    const turned: any = await turnProject(model(), 'y', 'x', newId);
    const [pocket, engrave, repeat] = turned.operations;
    expect(pocket.alongAxis).toBe('x');
    expect(repeat.operations[0].alongAxis).toBe('y');
    expect(engrave).toEqual(
      jasmine.objectContaining({
        imageRotation: 90,
        rasterAngle: -45,
        // Its top-left corner goes to the top-right.
        imageAlignX: 'right',
        imageAlignY: 'top',
        imageOffsetX: 'a * 2',
        imageOffsetY: -3,
      }),
    );
  });

  it('turns back the other way to where it was', async () => {
    const start = model();
    const there = await turnProject(start, 'y', 'x', newId);
    const back: any = await turnProject(there, 'x', 'y', newId);
    expect(back.stock.width).toBe(start.stock.width);
    expect(back.stock.height).toBe(start.stock.height);
    expect(back.stock.x).toBe(10 as any);
    expect(back.stock.xyZero).toBe('xmin-ymax');
    const engrave = back.operations[1];
    expect(engrave.imageRotation).toBe(0);
    expect(engrave.rasterAngle).toBe(45);
    expect([engrave.imageAlignX, engrave.imageAlignY]).toEqual(['left', 'top']);
    expect(engrave.imageOffsetX).toBe(3);
  });
});
