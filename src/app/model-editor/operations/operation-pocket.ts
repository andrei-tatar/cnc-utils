import { FormlyFieldConfig } from '@ngx-formly/core';
import { DepthSteps, depthStepsFields } from './depth-steps';

export interface ModelType extends DepthSteps {
  type?: 'pocket';
  leaveStock: number;
  toolEngagement: number;
  strategy?: 'offset' | 'raster' | 'adaptive';
  alongAxis?: 'x' | 'y';
  allPassesInSameDirection?: boolean;
}

const hideUnlessRaster = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.strategy !== 'raster';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'strategy',
      type: 'enum',
      defaultValue: 'offset',
      props: {
        label: 'strategy',
        required: true,
        options: [
          { value: 'offset', label: 'offset' },
          { value: 'raster', label: 'raster' },
          { value: 'adaptive', label: 'adaptive (steady engagement)' },
        ],
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          field.model?.strategy === 'adaptive'
            ? 'from a helix, the cleared area grows a stepover at a time: the bit never takes more, in corners and slots too. Use a small engagement (0.1–0.25) and deep steps'
            : '',
      },
    },
    ...depthStepsFields(),
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'leave stock',
        required: true,
      },
    },
    {
      key: 'toolEngagement',
      type: 'number',
      defaultValue: 0.4,
      props: {
        min: 0,
        label: 'engagement',
        required: true,
      },
    },
    {
      key: 'alongAxis',
      type: 'enum',
      defaultValue: 'y',
      props: {
        label: 'along axis',
        required: true,
        options: [
          { value: 'x', label: 'x' },
          { value: 'y', label: 'y' },
        ],
      },
      expressions: { hide: hideUnlessRaster },
    },
    {
      key: 'allPassesInSameDirection',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'all passes same dir.',
      },
      expressions: { hide: hideUnlessRaster },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'pocket',
  label: 'pocket',
  fieldGroup: field,
} as const;
