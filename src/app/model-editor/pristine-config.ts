import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * A copy of a field config as written: its objects and arrays copied,
 * functions and anything else shared, a list's items (made by the form
 * from `fieldArray`) left out.
 */
export function pristine(field: FormlyFieldConfig): FormlyFieldConfig {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(field)) {
    if (key === 'fieldGroup' && field.fieldArray) continue;
    copy[key] = copyConfig((field as Record<string, unknown>)[key]);
  }
  return copy as FormlyFieldConfig;
}

function copyConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyConfig);
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return pristine(value as FormlyFieldConfig);
  }
  return value;
}
