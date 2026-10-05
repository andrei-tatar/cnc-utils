import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  DEFAULT_GCODE_OPTIONS,
  GcodeOptions,
} from '../../../cam/gcode-options';

export type ModelType = {
  gcode: GcodeOptions;
};

const d = DEFAULT_GCODE_OPTIONS;

const hideUnlessSpindle = (field: FormlyFieldConfig) => !field.model?.spindle;

export const field: FormlyFieldConfig = {
  key: 'gcode',
  type: 'section',
  defaultValue: {},
  props: {
    label: 'g-code',
    accent: '#475569',
  },
  fieldGroup: [
    {
      key: 'safetyHeight',
      type: 'number',
      defaultValue: d.safetyHeight,
      props: {
        label: 'safe height',
        description: 'for rapid moves and tool changes, mm above the stock',
        min: 0.1,
        required: true,
      },
    },
    {
      key: 'carveFeedRate',
      type: 'number',
      defaultValue: d.carveFeedRate,
      props: {
        label: 'feed rate',
        description: 'mm/min, for tools without their own',
        min: 1,
        required: true,
      },
    },
    {
      key: 'plungeFeedRate',
      type: 'number',
      defaultValue: d.plungeFeedRate,
      props: {
        label: 'plunge fr',
        description: 'mm/min, for tools without their own',
        min: 1,
        required: true,
      },
    },
    {
      key: 'toolChange',
      type: 'enum',
      defaultValue: d.toolChange,
      props: {
        label: 'tool changes',
        required: true,
        options: [
          { value: 'm6', label: 'T<n> M6' },
          { value: 'pause', label: 'pause (M0) to change by hand' },
          { value: 'none', label: 'none' },
        ],
      },
    },
    {
      key: 'skipSingleToolChange',
      type: 'boolean',
      defaultValue: d.skipSingleToolChange,
      props: {
        label: 'skip tool changes when only one tool is used',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => field.model?.toolChange === 'none',
      },
    },
    {
      key: 'spindle',
      type: 'boolean',
      defaultValue: d.spindle,
      props: {
        label: 'control the spindle (M3 / M5)',
      },
    },
    {
      key: 'spindleSpeed',
      type: 'number',
      defaultValue: d.spindleSpeed,
      props: {
        label: 'spindle speed',
        description: 'RPM',
        min: 0,
        required: true,
      },
      expressions: { hide: hideUnlessSpindle },
    },
    {
      key: 'spindleDelay',
      type: 'number',
      defaultValue: d.spindleDelay,
      props: {
        label: 'spin-up wait',
        description: 'seconds to wait after starting the spindle (G4)',
        min: 0,
        required: true,
      },
      expressions: { hide: hideUnlessSpindle },
    },
    {
      key: 'header',
      type: 'boolean',
      defaultValue: d.header,
      props: {
        label: 'start with G90 G21 G17 (absolute, mm, XY plane)',
      },
    },
    {
      key: 'returnHome',
      type: 'boolean',
      defaultValue: d.returnHome,
      props: {
        label: 'return to X0 Y0 at the end',
      },
    },
    {
      key: 'decimals',
      type: 'number',
      defaultValue: d.decimals,
      props: {
        label: 'decimal places',
        min: 0,
        max: 6,
        required: true,
      },
      validators: { validation: ['whole-number'] },
    },
  ],
};
