import { emptyModel, ModelType } from './model';
import {
  movePoint,
  moveShape,
  selectedShapeId,
  selectShape,
  shapeEditing,
} from './shape-editing';

const model = (shapes: any[], operations: any[] = []): ModelType =>
  ({ ...emptyModel(), shapes, operations }) as ModelType;

const polyline = (extra: any = {}) => ({
  id: 'p',
  type: 'polyline',
  expanded: true,
  polylineClosed: true,
  polylinePoints: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 0 },
    { id: 'c', x: 'w', y: 5 },
  ],
  transforms: [],
  ...extra,
});

describe('editing a shape in the preview', () => {
  it('edits the shape open in the editor, while no operation is', () => {
    expect(selectedShapeId(model([polyline()]))).toBe('p');
    expect(
      selectedShapeId(model([polyline()], [{ id: 'o', expanded: true }])),
    ).toBeNull();
    expect(selectedShapeId(model([polyline({ expanded: false })]))).toBeNull();
  });

  it('opens the shape clicked, closing the rest and any operation', () => {
    const before = model(
      [polyline(), { id: 'q', type: 'circle', expanded: false }],
      [
        { id: 'o', expanded: true },
        {
          id: 'r',
          type: 'rotary-repeat',
          operations: [{ id: 'i', expanded: true }],
        },
      ],
    );
    const after = selectShape(before, 'q');
    expect(after.shapes.map((s: any) => s.expanded)).toEqual([false, true]);
    expect((after.operations[0] as any).expanded).toBe(false);
    expect((after.operations[1] as any).operations[0].expanded).toBe(false);
    expect(selectedShapeId(after)).toBe('q');
    // Nothing: shapes closed, operations left as they are.
    expect(selectShape(before, null).operations).toBe(before.operations);
  });

  it('gives a polyline’s points where they are, after its moves; expressions locked', () => {
    const raw = model([
      polyline({
        transforms: [
          { id: 't', type: 'translate', translateX: 5, translateY: 1 },
          { id: 'u', type: 'tabs' },
        ],
      }),
    ]);
    const resolved = model([
      {
        ...raw.shapes[0],
        polylinePoints: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 10, y: 0 },
          { id: 'c', x: 20, y: 5 },
        ],
      },
    ]);
    const editing = shapeEditing(raw, resolved)!;
    expect(editing.handles.map((h) => [h.x, h.y, h.locked])).toEqual([
      [5, 1, false],
      [15, 1, false],
      [25, 6, true],
    ]);
    // Dragged: back in the shape's own coordinates.
    const moved = movePoint(raw, 'p', editing.handles[1], { x: 17.5, y: 3 });
    expect((moved.shapes[0] as any).polylinePoints[1]).toEqual({
      id: 'b',
      x: 12.5,
      y: 2,
    });
    // A locked one stays.
    expect(movePoint(raw, 'p', editing.handles[2], { x: 0, y: 0 })).toBe(raw);
  });

  it('gives no points to drag behind a transform that moves the shape', () => {
    const raw = model([
      polyline({ transforms: [{ id: 't', type: 'rotate', angle: 30 }] }),
    ]);
    const editing = shapeEditing(raw, raw)!;
    expect(editing.handles).toEqual([]);
    expect(editing.note).toContain('only move it');
  });

  it('walks path data: relative points from where they start, curves’ control points', () => {
    const path = {
      id: 'p',
      type: 'path-data',
      expanded: true,
      transforms: [],
      pathCommands: [
        { id: '1', command: 'M', x: 10, y: 10 },
        { id: '2', command: 'l', x: 5, y: 0 },
        { id: '3', command: 'c', x1: 0, y1: 5, x2: 5, y2: 5, x: 5, y: 0 },
        { id: '4', command: 'V', y: 20 },
        { id: '5', command: 'Z' },
        { id: '6', command: 'h', x: -3 },
      ],
    };
    const raw = model([path]);
    const editing = shapeEditing(raw, raw)!;
    expect(editing.handles.map((h) => [h.itemId, h.x, h.y, h.control])).toEqual(
      [
        ['1', 10, 10, false],
        ['2', 15, 10, false],
        ['3', 15, 15, true],
        ['3', 20, 15, true],
        ['3', 20, 10, false],
        ['4', 20, 20, false],
        // Z goes back to (10, 10); h from there.
        ['6', 7, 10, false],
      ],
    );
    // A relative point dragged: relative to where its command starts.
    const moved = movePoint(raw, 'p', editing.handles[4], { x: 22, y: 12 });
    expect((moved.shapes[0] as any).pathCommands[2]).toEqual(
      jasmine.objectContaining({ x: 7, y: 2, x1: 0, y1: 5 }),
    );
    // V only moves up and down.
    const v = movePoint(raw, 'p', editing.handles[5], { x: 99, y: 25 });
    expect((v.shapes[0] as any).pathCommands[3]).toEqual({
      id: '4',
      command: 'V',
      y: 25,
    });
  });

  it('moves a shape by its last move, or a new one after its transforms', () => {
    const ids = 'new';
    const plain = moveShape(model([polyline()]), 'p', 2.345, -1, ids);
    expect((plain.shapes[0] as any).transforms).toEqual([
      {
        id: 'new',
        disabled: false,
        expanded: false,
        type: 'translate',
        translateX: 2.35,
        translateY: -1,
      },
    ]);
    const again = moveShape(plain, 'p', 1, 1, ids);
    expect((again.shapes[0] as any).transforms.length).toBe(1);
    expect((again.shapes[0] as any).transforms[0]).toEqual(
      jasmine.objectContaining({ translateX: 3.35, translateY: 0 }),
    );
    // Behind a move written as an expression: a new one.
    const expression = model([
      polyline({
        transforms: [
          { id: 't', type: 'translate', translateX: 'a', translateY: 0 },
        ],
      }),
    ]);
    expect(
      (moveShape(expression, 'p', 1, 1, ids).shapes[0] as any).transforms
        .length,
    ).toBe(2);
  });
});
