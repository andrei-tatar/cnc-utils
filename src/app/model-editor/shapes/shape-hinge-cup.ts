import { FormlyFieldConfig } from '@ngx-formly/core';

/** Where a hinge's screw (or dowel) holes go, by maker. */
export const HINGE_SYSTEMS = {
  blum: { label: 'Blum (45 mm apart, 9.5 mm back)', spacing: 45, offset: 9.5 },
  hettich: {
    label: 'Hettich (48 mm apart, 6 mm back)',
    spacing: 48,
    offset: 6,
  },
  grass: {
    label: 'Grass (45 mm apart, 9.5 mm back)',
    spacing: 45,
    offset: 9.5,
  },
} as const;

/**
 * The holes for a European (concealed) hinge in a door: the cup and its two
 * screw holes. The door's edge runs along the X axis (y = 0), the door below
 * it, the cup's centre on the Y axis.
 */
export interface ModelType {
  type: 'hinge-cup';
  hingeCupDiameter: number;
  /** From the door's edge to the edge of the cup (mm), usually 3–6. */
  hingeBoring: number;
  hingeSystem: keyof typeof HINGE_SYSTEMS | 'custom';
  /** Custom: between the screw holes (mm). */
  hingeScrewSpacing: number;
  /** Custom: from the cup's centre back to the screw holes' line (mm). */
  hingeScrewOffset: number;
  /** 0 makes the screw holes points (to drill); else holes this wide. */
  hingeScrewDiameter: number;
  /** Which of the holes the shape has. */
  hingeParts: 'both' | 'cup' | 'screws';
}

const hideUnlessCustom = (field: FormlyFieldConfig) =>
  field.model?.hingeSystem !== 'custom';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'hingeParts',
      type: 'enum',
      defaultValue: 'both',
      props: {
        label: 'holes',
        required: true,
        options: [
          { value: 'both', label: 'the cup and its screw holes' },
          { value: 'cup', label: 'the cup only' },
          { value: 'screws', label: 'the screw holes only' },
        ],
      },
    },
    {
      key: 'hingeCupDiameter',
      type: 'number',
      defaultValue: 35,
      props: {
        label: 'cup diameter',
        description: 'mm; 35 for most, 26 for compact hinges',
        min: 0,
        required: true,
      },
    },
    {
      key: 'hingeBoring',
      type: 'number',
      defaultValue: 5,
      props: {
        label: 'boring distance',
        description:
          'mm from the door’s edge (the X axis) to the cup’s edge, usually 3–6',
        required: true,
      },
    },
    {
      key: 'hingeSystem',
      type: 'enum',
      defaultValue: 'blum',
      props: {
        label: 'screw holes',
        required: true,
        options: [
          ...Object.entries(HINGE_SYSTEMS).map(([value, { label }]) => ({
            value,
            label,
          })),
          { value: 'custom', label: 'custom' },
        ],
      },
    },
    {
      key: 'hingeScrewSpacing',
      type: 'number',
      defaultValue: 45,
      props: { label: 'screw spacing', min: 0, required: true },
      expressions: { hide: hideUnlessCustom },
    },
    {
      key: 'hingeScrewOffset',
      type: 'number',
      defaultValue: 9.5,
      props: {
        label: 'screws back',
        description: 'mm from the cup’s centre, away from the edge',
        required: true,
      },
      expressions: { hide: hideUnlessCustom },
    },
    {
      key: 'hingeScrewDiameter',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'screw hole diameter',
        description: '0 for points to drill; 8 for press-in dowels',
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
  type: 'hinge-cup',
  label: 'European hinge cup',
  fieldGroup: field,
} as const;
