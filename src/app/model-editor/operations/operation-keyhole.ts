import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Keyhole slots for hanging a piece on a screw: at each of the shape's
 * points (and, if asked, outline centres) a keyhole bit plunges, runs along
 * the slot and comes back out where it went in.
 */
export interface ModelType {
  type?: 'keyhole';
  keyholeAt: 'points' | 'centers';
  startDepth: number;
  /** How deep the bottom of the head goes (mm, below the start depth). */
  depth: number;
  /** From the entry hole's centre to the slot end's (mm). */
  slotLength: number;
  /** Which way the slot runs from the entry hole (degrees, 90 is +Y). */
  slotAngle: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'keyholeAt',
      type: 'enum',
      defaultValue: 'centers',
      props: {
        label: 'keyholes at',
        required: true,
        options: [
          { value: 'centers', label: 'points, and the centre of each outline' },
          { value: 'points', label: 'points only' },
        ],
      },
    },
    {
      key: 'startDepth',
      type: 'number',
      defaultValue: 0,
      props: { label: 'start depth', required: true },
    },
    {
      key: 'depth',
      type: 'number',
      defaultValue: 8,
      props: {
        label: 'depth',
        description: 'mm to the bottom of the head',
        min: 0,
        required: true,
      },
    },
    {
      key: 'slotLength',
      type: 'number',
      defaultValue: 10,
      props: {
        label: 'slot length',
        description: 'mm from the entry hole to the end of the slot',
        min: 0,
        required: true,
      },
    },
    {
      key: 'slotAngle',
      type: 'number',
      defaultValue: 90,
      props: {
        label: 'slot towards',
        description:
          '°: 90 runs towards +Y (up, for a piece hung the way it’s drawn), 0 towards +X',
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'keyhole',
  label: 'keyhole slot',
  fieldGroup: field,
} as const;
