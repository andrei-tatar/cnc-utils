import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Relief at corners a round tool can't reach, so square parts fit square
 * holes: a circle the size of the tool cut into each corner.
 */
export interface ModelType {
  type: 'dogbone';
  /** Diameter of the tool that will cut the shape. */
  dogboneTool: number;
  /**
   * Where the tool runs: inside the shape (pockets, holes, inside profiles)
   * relieves its outside corners; outside it (outside profiles) relieves
   * its inside corners.
   */
  dogboneSide: 'inside' | 'outside';
  /** Along the corner's bisector, or into one of its sides. */
  dogboneStyle: 'dogbone' | 't-bone-long' | 't-bone-short';
  /** Only corners at least this sharp, in degrees. */
  dogboneMaxAngle: number;
  /** Extra size on the relief, in mm, so the tool passes freely. */
  dogboneClearance: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'dogboneTool',
      type: 'number',
      defaultValue: 3,
      props: {
        label: 'tool diameter',
        description: 'mm, of the tool that will cut this shape',
        min: 0.01,
        required: true,
      },
    },
    {
      key: 'dogboneSide',
      type: 'enum',
      defaultValue: 'inside',
      props: {
        label: 'tool cuts',
        required: true,
        options: [
          {
            value: 'inside',
            label: 'inside the shape (pocket, hole, mortise)',
          },
          { value: 'outside', label: 'outside the shape (part, tenon)' },
        ],
      },
    },
    {
      key: 'dogboneStyle',
      type: 'enum',
      defaultValue: 'dogbone',
      props: {
        label: 'style',
        required: true,
        options: [
          { value: 'dogbone', label: 'dogbone (into the corner)' },
          { value: 't-bone-long', label: 'T-bone, into the longer side' },
          { value: 't-bone-short', label: 'T-bone, into the shorter side' },
        ],
      },
    },
    {
      key: 'dogboneMaxAngle',
      type: 'number',
      defaultValue: 120,
      props: {
        label: 'corners up to',
        description: '°; blunter corners are left alone',
        min: 1,
        max: 179,
        required: true,
      },
    },
    {
      key: 'dogboneClearance',
      type: 'number',
      defaultValue: 0.05,
      props: {
        label: 'clearance',
        description: 'mm added to the relief, so the tool isn’t a tight fit',
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
  type: 'dogbone',
  label: 'dogbone corners',
  fieldGroup: field,
} as const;
