import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'convexhull';
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
  type: 'convexhull',
  label: 'convex hull',
  fieldGroup: field,
} as const;
