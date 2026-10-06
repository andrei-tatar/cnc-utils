import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { VariableType } from './evaluate';
import { formVariables } from './field';

export type { VariableType } from './evaluate';

export type ModelType = {
  variables: VariableType[];
};

/** The variable's name problem, if any. */
function nameError(field: FormlyFieldConfig): string | undefined {
  return formVariables(field).byId.get(field.model?.id)?.nameError;
}

/** A name no variable has yet: a, b, …, z, then v1, v2, …. */
function freeName(field: FormlyFieldConfig): string {
  const taken = new Set(
    (rootModel(field)?.variables ?? []).map((v: VariableType) =>
      v?.name?.trim(),
    ),
  );
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (const name of letters) {
    if (!taken.has(name)) return name;
  }
  let n = 1;
  while (taken.has(`v${n}`)) n++;
  return `v${n}`;
}

export const field: FormlyFieldConfig = {
  key: 'variables',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'variables',
    itemLabel: 'variable',
    accent: '#7c3aed',
    collapsible: true,
    // One row per variable, edited in place.
    inline: true,
    description:
      'Use them in any number field, e.g. “width / 2”. A variable can use the ones above it.',
  },
  fieldArray: {
    fieldGroupClassName: 'variable-row',
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
        className: 'd-none',
      },
      {
        key: 'name',
        type: 'input',
        className: 'variable-name',
        props: {
          placeholder: 'name',
          attributes: {
            'aria-label': 'variable name',
            autocomplete: 'off',
            spellcheck: 'false',
          },
        },
        validators: {
          variableName: {
            expression: (_: unknown, field: FormlyFieldConfig) =>
              !nameError(field),
            message: (_: unknown, field: FormlyFieldConfig) =>
              nameError(field) ?? '',
          },
        },
        hooks: {
          onInit: (field: FormlyFieldConfig) => {
            if (!field.formControl?.value) {
              field.formControl?.setValue(freeName(field));
            }
          },
        },
      },
      {
        key: 'value',
        type: 'number',
        className: 'variable-value',
        defaultValue: 0,
        props: {
          placeholder: 'value, e.g. 10 or sqrt(2) * a',
          required: true,
          // Only the variables above it are usable.
          variable: true,
          attributes: { 'aria-label': 'variable value' },
        },
      },
    ],
  },
};
