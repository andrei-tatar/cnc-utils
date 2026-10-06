import type { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import {
  Evaluated,
  evaluateNumber,
  evaluateVariables,
  NumberInput,
  Variables,
} from './evaluate';
import { numberSchema, resolveNumbers } from './resolve';

/** The model's variables, from any field in the form. */
export function formVariables(field: FormlyFieldConfig | undefined): Variables {
  return evaluateVariables(rootModel(field)?.variables);
}

/**
 * A number field's value with the variables in place (`null` while it's
 * empty). A variable's own value can only use the variables above it.
 */
export function evaluateField(field: FormlyFieldConfig): Evaluated | null {
  const input: NumberInput = field.formControl?.value;
  if (input === null || input === undefined || input === '') {
    return null;
  }
  if (field.props?.['variable']) {
    const result = formVariables(field).byId.get(field.model?.id);
    if (result) {
      return 'value' in result
        ? { value: result.value }
        : { error: result.error };
    }
  }
  return evaluateNumber(input, formVariables(field));
}

/**
 * The number in a field of the model (e.g. `field.model.peck`), for
 * settings that depend on it; undefined when it can't be worked out.
 */
export function numberIn(
  field: FormlyFieldConfig | undefined,
  input: NumberInput,
): number | undefined {
  const result = evaluateNumber(input, formVariables(field));
  return result && 'value' in result ? result.value : undefined;
}

/**
 * An item of a list (a shape, a tool, …) with its expressions worked out.
 * `listField` is the list's field. `forDisplay`: for its label (see
 * `resolveNumbers`).
 */
export function resolvedItem<T>(
  listField: FormlyFieldConfig,
  item: T,
  forDisplay = false,
): T {
  const fieldArray = listField.fieldArray;
  if (!fieldArray || typeof fieldArray !== 'object') {
    return item;
  }
  return resolveNumbers(
    item,
    numberSchema(fieldArray.fieldGroup ?? []),
    formVariables(listField),
    forDisplay,
  );
}

/**
 * The item `field` belongs to (in a list), with its expressions worked out
 * for its label.
 */
export function resolvedModelOf(field: FormlyFieldConfig): any {
  const list = field.parent?.parent;
  return list ? resolvedItem(list, field.model, true) : field.model;
}
