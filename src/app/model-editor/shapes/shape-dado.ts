import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * A dado (or groove) for a panel: as wide as the panel is thick, measured,
 * plus the play, along X from 0 to its length, centred on Y = 0. An open
 * end runs on past the length (out over the edge of the board), so the
 * bit's round doesn't stop short there.
 */
export interface ModelType {
  type: 'dado';
  dadoLength: number;
  /** The panel that goes in it, measured (mm). */
  dadoThickness: number;
  /** How much wider than the panel (mm). */
  dadoPlay: number;
  /** Which ends run out past the length. */
  dadoEnds: 'stopped' | 'start' | 'end' | 'both';
  /** How far an open end runs on (mm). */
  dadoOverrun: number;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'dadoLength',
      type: 'number',
      defaultValue: 200,
      props: { label: 'length', min: 0, required: true },
    },
    {
      key: 'dadoThickness',
      type: 'number',
      defaultValue: 18,
      props: {
        label: 'panel',
        description: 'mm thick: measure the panel (sheet goods vary)',
        min: 0,
        required: true,
      },
    },
    {
      key: 'dadoPlay',
      type: 'number',
      defaultValue: 0.2,
      props: {
        label: 'play',
        description: 'mm wider than the panel',
        min: 0,
        required: true,
      },
    },
    {
      key: 'dadoEnds',
      type: 'enum',
      defaultValue: 'both',
      props: {
        label: 'open ends',
        required: true,
        options: [
          { value: 'both', label: 'both: through' },
          { value: 'start', label: 'at the start' },
          { value: 'end', label: 'at the end' },
          { value: 'stopped', label: 'neither: stopped' },
        ],
      },
    },
    {
      key: 'dadoOverrun',
      type: 'number',
      defaultValue: 5,
      props: {
        label: 'run on',
        description: 'mm past an open end, out over the board’s edge',
        min: 0,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => field.model?.dadoEnds === 'stopped',
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

export const Definition = {
  type: 'dado',
  label: 'dado / groove (for a panel)',
  fieldGroup: field,
} as const;
