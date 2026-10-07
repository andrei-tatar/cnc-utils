import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * A bowtie (butterfly key), centred on 0, 0, lying along X: two flared
 * halves meeting at a narrow waist. Round its corners with a transform to
 * match the bit that cuts its pocket.
 */
export interface ModelType {
  type: 'bowtie';
  bowtieLength: number;
  /** Across each end (mm). */
  bowtieEndWidth: number;
  /** Across the middle (mm). */
  bowtieWaist: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'bowtieLength',
      type: 'number',
      defaultValue: 60,
      props: { label: 'length', min: 0, required: true },
    },
    {
      key: 'bowtieEndWidth',
      type: 'number',
      defaultValue: 30,
      props: {
        label: 'end width',
        description: 'mm across each end',
        min: 0,
        required: true,
      },
    },
    {
      key: 'bowtieWaist',
      type: 'number',
      defaultValue: 12,
      props: {
        label: 'waist',
        description: 'mm across the middle',
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
  type: 'bowtie',
  label: 'bowtie (butterfly key)',
  fieldGroup: field,
} as const;
