import { emptyModel, ModelFieldConfig } from '../model-editor/model';
import { describeList, findListField } from './form-schema';

describe('form schema', () => {
  const root = emptyModel();

  it('finds lists, inside items too', () => {
    expect(findListField(ModelFieldConfig, 'shapes')?.key).toBe('shapes');
    expect(findListField(ModelFieldConfig, 'transforms')?.key).toBe(
      'transforms',
    );
    expect(findListField(ModelFieldConfig, 'nothing')).toBeNull();
  });

  it('lists a typed list’s types and common fields', () => {
    const schema = describeList(
      findListField(ModelFieldConfig, 'shapes')!,
      root,
    );
    expect(schema.types).toContain({ type: 'circle', label: 'circle' });
    const keys = schema.common.map((f) => f.key);
    expect(keys).toContain('name');
    expect(keys).toContain('transforms');
    expect(keys).not.toContain('diameter');
    expect(keys).not.toContain('id');
    expect(schema.common.find((f) => f.key === 'transforms')?.typedList).toBe(
      true,
    );
  });

  it('gives a type’s own fields with their defaults', () => {
    const schema = describeList(
      findListField(ModelFieldConfig, 'shapes')!,
      root,
      'circle',
    );
    expect(schema.fields).toContain(
      jasmine.objectContaining({
        key: 'diameter',
        kind: 'number',
        default: 50,
        min: 0,
        required: true,
      }),
    );
    // Not another type's.
    expect(schema.fields!.some((f) => f.key === 'width')).toBe(false);
  });

  it('describes operations by type, with their choices', () => {
    const schema = describeList(
      findListField(ModelFieldConfig, 'operations')!,
      root,
      'drill',
    );
    const drillAt = schema.fields!.find((f) => f.key === 'drillAt');
    expect(drillAt?.kind).toBe('choice');
    expect(drillAt?.options?.map((o) => o.value)).toEqual([
      'centers',
      'points',
    ]);
    // Shown for a drill bit only.
    expect(
      schema.fields!.find((f) => f.key === 'fullDiameter')?.conditional,
    ).toBeTrue();
  });

  it('describes settings sections', () => {
    const schema = describeList(
      findListField(ModelFieldConfig, 'stock')!,
      root,
    );
    expect(schema.types).toEqual([]);
    expect(schema.common.map((f) => f.key)).toContain('thickness');
  });
});
