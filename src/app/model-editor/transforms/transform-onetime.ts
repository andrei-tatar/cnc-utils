import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'onetime';
}

const field: FormlyFieldConfig = {
  fieldGroup: [],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'onetime',
  label: 'onetime',
  fieldGroup: field,
} as const;
