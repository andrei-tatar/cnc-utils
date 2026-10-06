import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Drop points that barely change the outline: imported and traced shapes
 * often have far more than needed, which slows everything after them.
 */
export interface ModelType {
  type: 'simplify';
  /** Points closer than this to the simplified outline are dropped (mm). */
  simplifyTolerance: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'simplifyTolerance',
      type: 'number',
      defaultValue: 0.05,
      props: {
        label: 'tolerance',
        description: 'mm the outline may move',
        min: 0,
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'simplify',
  label: 'simplify',
  fieldGroup: field,
} as const;
