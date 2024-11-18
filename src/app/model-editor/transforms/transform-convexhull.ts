import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'convexhull';
  atShapeLevel: boolean;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'atShapeLevel',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'at shape level',
      },
    },
  ],
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
