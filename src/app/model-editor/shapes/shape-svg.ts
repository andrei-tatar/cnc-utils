import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'svg';
  svg: string;
  /** Name of the file the SVG was loaded from (display only). */
  fileName?: string;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'fileName',
      type: 'hidden',
    },
    {
      key: 'svg',
      type: 'file',
      props: {
        label: 'file',
        accept: '.svg,image/svg+xml',
        fileNameKey: 'fileName',
        required: true,
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
  type: 'svg',
  label: 'svg',
  fieldGroup: field,
} as const;
