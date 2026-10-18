import { inject, Injectable } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormBuilder } from '@ngx-formly/core';
import { ModelFieldConfig, ModelType } from '../model-editor/model';
import { snapshot } from '../services/model-store.service';

/**
 * Puts a model through the editor's form without showing it, so it comes
 * out as the editor would make it: defaults filled in where fields are
 * missing (an item added with only its type and size), fields that don't
 * apply dropped, worked-out feeds written in. The pipelines then never see
 * a half-made item.
 */
@Injectable({ providedIn: 'root' })
export class ModelNormalizer {
  private readonly builder = inject(FormlyFormBuilder);

  normalize(model: ModelType): ModelType {
    const copy = snapshot(model);
    // The editor's own configs carry the live form's state (its lists'
    // items): built from a fresh copy of them.
    const fields = ModelFieldConfig.map(pristine);
    this.builder.build({
      form: new FormGroup({}),
      fieldGroup: fields,
      model: copy,
      options: { formState: {} },
    });
    return copy;
  }
}

/**
 * A copy of a field config as written: its objects and arrays copied,
 * functions and anything else shared, a list's items (made by the form
 * from `fieldArray`) left out.
 */
function pristine(field: FormlyFieldConfig): FormlyFieldConfig {
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
