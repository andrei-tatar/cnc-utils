import { FormlyFieldConfig } from '@ngx-formly/core';

export interface ModelType {
  type: 'rotate';
  rotateAngle: number;
  around: `${'xmin' | 'xmax' | 'xcenter'}-${'ymin' | 'ymax' | 'ycenter'}`;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'rotateAngle',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'angle',
        required: true,
      },
    },
    {
      key: 'around',
      type: 'enum',
      defaultValue: 'xcenter-ycenter',
      props: {
        label: 'around',
        required: true,
        options: [
          { value: 'xcenter-ycenter', label: 'center' },
          { value: 'xmin-ymin', label: 'xmin ymin' },
          { value: 'xmax-ymin', label: 'xmax ymin' },
          { value: 'xcenter-ymin', label: 'xcenter ymin' },
          { value: 'xmin-ymax', label: 'xmin ymax' },
          { value: 'xmax-ymax', label: 'xmax ymax' },
          { value: 'xcenter-ymax', label: 'xcenter ymax' },
          { value: 'xmin-ycenter', label: 'xmin ycenter' },
          { value: 'xmax-ycenter', label: 'xmax ycenter' },
        ],
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
  type: 'rotate',
  label: 'rotate',
  fieldGroup: field,
} as const;
