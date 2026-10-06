import { FormlyFieldConfig } from '@ngx-formly/core';
import { ModelFieldConfig } from '../model';
import { resolveModel } from './resolve';

describe('resolveModel', () => {
  const fields: FormlyFieldConfig[] = [
    {
      key: 'variables',
      type: 'repeat',
      fieldArray: {
        fieldGroup: [
          { key: 'name', type: 'input' },
          { key: 'value', type: 'number' },
        ],
      },
    },
    {
      key: 'items',
      type: 'repeat',
      fieldArray: {
        fieldGroup: [
          { key: 'label', type: 'input' },
          { fieldGroup: [{ key: 'size', type: 'number' }] },
          {
            key: 'children',
            type: 'repeat',
            fieldArray: { fieldGroup: [{ key: 'offset', type: 'number' }] },
          },
        ],
      },
    },
    {
      key: 'settings',
      type: 'section',
      fieldGroup: [{ key: 'height', type: 'number' }],
    },
  ];

  it('puts the variables’ values in place of expressions in number fields', () => {
    const big = 'x'.repeat(1000);
    const model: any = {
      variables: [
        { id: '1', name: 'a', value: 10 },
        { id: '2', name: 'b', value: 'a * 3' },
      ],
      items: [
        {
          label: 'a * 2', // not a number field: left alone
          size: 'b + 1',
          file: big,
          children: [{ offset: '-a' }, { offset: 4 }],
        },
      ],
      settings: { height: 'max(a, b)' },
    };
    const resolved = resolveModel(model, fields);
    expect(resolved.items[0].label).toBe('a * 2');
    expect(resolved.items[0].size).toBe(31);
    expect(resolved.items[0].children).toEqual([
      { offset: -10 },
      { offset: 4 },
    ]);
    expect(resolved.items[0].file).toBe(big);
    expect(resolved.settings.height).toBe(30);
    expect(resolved.variables.map((v: any) => v.value)).toEqual([10, 30]);
    // The model itself is left as it was.
    expect(model.items[0].size).toBe('b + 1');
  });

  it('leaves a field empty when its expression has an error', () => {
    const resolved = resolveModel(
      { variables: [], items: [{ size: 'nope * 2' }] },
      fields,
    );
    expect(resolved.items[0].size).toBeNull();
  });

  it('finds the number fields of the real editor', () => {
    const model: any = {
      variables: [{ id: 'v', name: 'd', value: 6 }],
      shapes: [
        {
          id: 's',
          type: 'circle',
          diameter: 'd * 2',
          transforms: [
            { id: 't', type: 'translate', translateX: 'd', translateY: 0 },
          ],
        },
      ],
      tools: [{ id: 'tool', diameter: 'd / 2' }],
      operations: [
        { id: 'o', type: 'pocket', depth: 'd / 3', steps: 'round(d / 4)' },
      ],
      stock: { width: 'd * 100' },
      gcode: {},
    };
    const resolved: any = resolveModel(model, ModelFieldConfig);
    expect(resolved.shapes[0].diameter).toBe(12);
    expect(resolved.shapes[0].transforms[0].translateX).toBe(6);
    expect(resolved.tools[0].diameter).toBe(3);
    expect(resolved.stock.width).toBe(600);
    expect(resolved.operations[0].depth).toBe(2);
    expect(resolved.operations[0].steps).toBe(2);
  });
});
