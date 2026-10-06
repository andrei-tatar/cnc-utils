import { FormlyFieldConfig } from '@ngx-formly/core';

/** A straight slot with round ends, centred on 0, 0, lying along X. */
export interface ModelType {
  type: 'slot';
  /** Overall length, round ends included. */
  slotLength: number;
  slotWidth: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'slotLength',
      type: 'number',
      defaultValue: 30,
      props: {
        label: 'length',
        description: 'mm overall, ends included',
        min: 0,
        required: true,
      },
    },
    {
      key: 'slotWidth',
      type: 'number',
      defaultValue: 8,
      props: { label: 'width', min: 0, required: true },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'slot',
  label: 'slot',
  fieldGroup: field,
} as const;
