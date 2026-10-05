import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Replace the shape with the rectangle that fits around it: one for the
 * whole shape, or one per polygon (holes don't get their own).
 */
export interface ModelType {
  type: 'bounds';
  boundsOf: 'shape' | 'polygon';
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'boundsOf',
      type: 'enum',
      defaultValue: 'shape',
      props: {
        label: 'around',
        required: true,
        options: [
          { value: 'shape', label: 'the whole shape' },
          { value: 'polygon', label: 'each polygon (not holes)' },
        ],
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'bounds',
  label: 'bounding rectangle',
  fieldGroup: field,
} as const;
