import { emptyModel, ModelType } from './model';
import { importParts } from './import-parts';

const model = (parts: Partial<ModelType>): ModelType =>
  ({ ...emptyModel(), ...parts }) as ModelType;

describe('importing parts from another project', () => {
  const source = model({
    variables: [
      { id: 'id-v1', name: 'size', value: 40 },
      { id: 'id-v2', name: 'half', value: 'size / 2' },
      { id: 'id-v3', name: 'unused', value: 1 },
      { id: 'id-v4', name: 'depth', value: 3 },
    ] as any,
    shapes: [
      { id: 'id-s1', type: 'circle', diameter: 'half', transforms: [] },
      {
        id: 'id-s2',
        type: 'rectangle',
        width: 10,
        height: 10,
        expanded: true,
        transforms: [{ id: 'id-t1', type: 'tabs', tabCount: 4 }],
      },
      {
        id: 'id-s3',
        type: 'boolean',
        operands: [
          { id: 'id-p1', shapeId: 'id-s2' },
          { id: 'id-p2', shapeId: 'id-s1', operation: 'difference' },
        ],
        transforms: [],
      },
      { id: 'id-s4', type: 'circle', diameter: 5, transforms: [] },
    ] as any,
    tools: [
      { id: 'id-k1', index: 1, bitType: 'end-mill', diameter: 6 },
      { id: 'id-k2', index: 2, bitType: 'v-bit', diameter: 12, vAngle: 60 },
      { id: 'id-k3', index: 3, bitType: 'drill', diameter: 5 },
    ] as any,
    operations: [
      {
        id: 'id-o1',
        type: 'pocket',
        shapeId: 'id-s3',
        toolId: 'id-k1',
        depth: 'depth',
      },
      { id: 'id-o2', type: 'rotate', angle: 90 },
      { id: 'id-o3', type: 'v-carve', shapeId: 'id-s3', toolId: 'id-k2' },
      {
        id: 'id-o4',
        type: 'v-carve-clear',
        vcarveOperationId: 'id-o3',
        toolId: 'id-k1',
      },
      { id: 'id-o5', type: 'drill', shapeId: 'id-s4', toolId: 'id-k3' },
    ] as any,
  });

  const target = model({
    variables: [{ id: 'own-v', name: 'depth', value: 6 }] as any,
    shapes: [
      { id: 'own-s', type: 'circle', diameter: 1, transforms: [] },
    ] as any,
    tools: [
      { id: 'own-k', index: 2, name: 'mine', bitType: 'end-mill', diameter: 6 },
    ] as any,
  });

  let next = 0;
  const newId = () => `new-${++next}`;
  beforeEach(() => (next = 0));

  it('brings a shape with what it’s made of, the operations that cut it, their tools and variables', () => {
    const { model: result, summary } = importParts(
      target,
      source,
      ['id-s3'],
      true,
      newId,
    );
    expect(summary).toEqual({
      shapes: 3,
      operations: 3,
      addedTools: 1,
      reusedTools: 1,
      variables: 2,
      sharedVariables: ['depth'],
    });
    const shapes: any[] = result.shapes;
    expect(shapes.length).toBe(4);
    const [circle, rect, union] = shapes.slice(1);
    // New ids, references following them.
    expect(union.operands.map((o: any) => o.shapeId)).toEqual([
      rect.id,
      circle.id,
    ]);
    expect(rect.transforms[0].id).not.toBe('id-t1');
    expect(rect.expanded).toBe(false);
    const ops: any[] = result.operations;
    expect(ops.map((o) => o.type)).toEqual([
      'pocket',
      'v-carve',
      'v-carve-clear',
    ]);
    expect(
      ops.every((o) => o.shapeId === undefined || o.shapeId === union.id),
    ).toBe(true);
    expect(ops[2].vcarveOperationId).toBe(ops[1].id);
    // The end mill is one this project has; the V-bit is copied, its number
    // free here.
    expect(ops[0].toolId).toBe('own-k');
    expect(ops[2].toolId).toBe('own-k');
    const vbit: any = result.tools.find((t: any) => t.id === ops[1].toolId);
    expect(vbit).toEqual(
      jasmine.objectContaining({ bitType: 'v-bit', index: 1 }),
    );
    // half and size come along; depth is this project's own.
    expect(result.variables.map((v: any) => v.name)).toEqual([
      'depth',
      'size',
      'half',
    ]);
  });

  it('brings shapes alone when asked', () => {
    const { model: result, summary } = importParts(
      target,
      source,
      ['id-s4'],
      false,
      newId,
    );
    expect(summary.shapes).toBe(1);
    expect(summary.operations).toBe(0);
    expect(result.tools).toEqual(target.tools);
    expect(result.operations).toEqual([]);
  });
});
