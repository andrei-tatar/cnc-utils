import type { FormlyFieldConfig } from '@ngx-formly/core';
import { evaluateNumber } from './evaluate';
import { fieldVariables } from './field';

const variables = [
  { id: 'a', name: 'a', value: 2 },
  { id: 'b', name: 'b', value: 'a * 3' },
  { id: 'c', name: 'c', value: 'b + 1' },
];

/** A number field in a form whose model has `variables`. */
function numberField(
  props: object = {},
  model: object = {},
): FormlyFieldConfig {
  return { props, model, parent: { model: { variables } } };
}

describe('fieldVariables', () => {
  it('gives any other number field every variable', () => {
    const { scope } = fieldVariables(numberField());
    expect([...scope]).toEqual([
      ['a', 2],
      ['b', 6],
      ['c', 7],
    ]);
  });

  it('gives a variable only the ones above it, and says why not the rest', () => {
    const field = numberField({ variable: true }, variables[1]);
    const result = fieldVariables(field);
    expect([...result.scope]).toEqual([['a', 2]]);
    expect(evaluateNumber('a + 1', result)).toEqual({ value: 3 });
    expect(evaluateNumber('b + 1', result)).toEqual({
      error: '“b” can’t use itself',
    });
    expect(evaluateNumber('c', result)).toEqual({
      error: '“c” is defined further down',
    });
  });
});
