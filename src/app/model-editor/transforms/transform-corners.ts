import { FormlyFieldConfig } from '@ngx-formly/core';

/** Round (fillet) or bevel (chamfer) the shape's corners. */
export interface ModelType {
  type: 'corners';
  cornerMode: 'fillet' | 'chamfer';
  /** Fillet radius, or how far the chamfer reaches along each edge (mm). */
  cornerSize: number;
  cornerWhich: 'all' | 'convex' | 'concave';
  /** Only corners at least this sharp, in degrees. */
  cornerMaxAngle: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'cornerMode',
      type: 'enum',
      defaultValue: 'fillet',
      props: {
        label: 'corners',
        required: true,
        options: [
          { value: 'fillet', label: 'round (fillet)' },
          { value: 'chamfer', label: 'bevel (chamfer)' },
        ],
      },
    },
    {
      key: 'cornerSize',
      type: 'number',
      defaultValue: 2,
      props: {
        label: 'size',
        min: 0,
        required: true,
      },
      expressions: {
        'props.description': (field: FormlyFieldConfig) =>
          field.model?.cornerMode === 'chamfer'
            ? 'mm along each edge'
            : 'radius, mm',
      },
    },
    {
      key: 'cornerWhich',
      type: 'enum',
      defaultValue: 'all',
      props: {
        label: 'which',
        required: true,
        options: [
          { value: 'all', label: 'all corners' },
          { value: 'convex', label: 'outside corners only' },
          { value: 'concave', label: 'inside corners only' },
        ],
      },
    },
    {
      key: 'cornerMaxAngle',
      type: 'number',
      defaultValue: 160,
      props: {
        label: 'corners up to',
        description: '°; blunter corners (and curves) are left alone',
        min: 1,
        max: 179,
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'corners',
  label: 'round / bevel corners',
  fieldGroup: field,
} as const;
