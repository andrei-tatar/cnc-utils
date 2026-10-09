import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  DEFAULT_GCODE_OPTIONS,
  GcodeOptions,
} from '../../../cam/gcode-options';
import { CURVE_TOLERANCE } from '../../../cam/geometry';
import { MACHINES } from '../../../cam/feeds-speeds';
import { onRotary } from '../operations/rotation';

export type ModelType = {
  gcode: GcodeOptions;
};

const d = DEFAULT_GCODE_OPTIONS;

const hideUnlessSpindle = (field: FormlyFieldConfig) => !field.model?.spindle;
const hideUnlessReference = (field: FormlyFieldConfig) =>
  (field.model?.referencePoint ?? 'none') === 'none';

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
      key: 'machine',
      type: 'enum',
      defaultValue: d.machine,
      props: {
        label: 'machine',
        description: 'what operations’ feeds & speeds are worked out for',
        required: true,
        options: MACHINES.map((machine) => ({
          value: machine.id,
          label: machine.name,
        })),
      },
    },
    {
      wrappers: ['group'],
      props: {
        label: 'feeds & speeds',
        collapsible: true,
        startOpen: () => true,
      },
      fieldGroup: [
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
          key: 'rapidRate',
          type: 'number',
          defaultValue: d.rapidRate,
          props: {
            label: 'rapid speed',
            description:
              'mm/min your machine moves at with G0; only for the time estimate',
            min: 1,
            required: true,
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
      ],
    },
    {
      wrappers: ['group'],
      props: {
        label: 'moves',
        collapsible: true,
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
          key: 'optimizeTravel',
          type: 'boolean',
          defaultValue: d.optimizeTravel,
          props: {
            label: 'shorten travel between cuts',
            description:
              "cut each operation's shapes nearest first (holes before the outline around them) instead of in the order they come",
          },
        },
        {
          key: 'referencePoint',
          type: 'enum',
          defaultValue: d.referencePoint,
          props: {
            label: 'move the toolpaths',
            description:
              'puts this point of the cuts’ bounding box (tool centre) at the X / Y below; overrides the stock’s X0 Y0',
            required: true,
            options: [
              { value: 'none', label: 'no, keep them where they are' },
              { value: 'xmin-ymax', label: 'top-left' },
              { value: 'xcenter-ymax', label: 'top middle' },
              { value: 'xmax-ymax', label: 'top-right' },
              { value: 'xmin-ycenter', label: 'left middle' },
              { value: 'xcenter-ycenter', label: 'centre' },
              { value: 'xmax-ycenter', label: 'right middle' },
              { value: 'xmin-ymin', label: 'bottom-left' },
              { value: 'xcenter-ymin', label: 'bottom middle' },
              { value: 'xmax-ymin', label: 'bottom-right' },
            ],
          },
        },
        {
          key: 'referenceX',
          type: 'number',
          defaultValue: d.referenceX,
          props: { label: 'to X', required: true },
          expressions: { hide: hideUnlessReference },
        },
        {
          key: 'referenceY',
          type: 'number',
          defaultValue: d.referenceY,
          props: { label: 'to Y', required: true },
          expressions: { hide: hideUnlessReference },
        },
      ],
    },
    {
      wrappers: ['group'],
      props: {
        label: 'rotary axis',
        description:
          'how the controller names and turns it; safe height is raised to clear the stock’s corners as it turns',
        collapsible: true,
      },
      expressions: { hide: (field: FormlyFieldConfig) => !onRotary(field) },
      fieldGroup: [
        {
          key: 'rotaryAxis',
          type: 'enum',
          defaultValue: d.rotaryAxis,
          props: {
            label: 'letter',
            description: 'the axis’ name in the G-code (in degrees)',
            required: true,
            options: [
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
            ],
          },
        },
        {
          key: 'rotaryReversed',
          type: 'boolean',
          defaultValue: d.rotaryReversed,
          props: {
            label: 'turns the other way',
            description:
              'tick if a positive angle turns the top of the stock towards +Y (axis along X) or −X (along Y)',
          },
        },
      ],
    },
    {
      wrappers: ['group'],
      props: {
        label: 'program',
        description: 'start, tool changes, end',
        collapsible: true,
      },
      fieldGroup: [
        {
          key: 'header',
          type: 'boolean',
          defaultValue: d.header,
          props: {
            label: 'start with G90 G21 G17 (absolute, mm, XY plane)',
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
            hide: (field: FormlyFieldConfig) =>
              field.model?.toolChange === 'none',
          },
        },
        {
          key: 'operationComments',
          type: 'boolean',
          defaultValue: d.operationComments,
          props: {
            label: 'describe each operation in a comment',
            description:
              'e.g. ; Operation 2: pocket 5 mm · circle Ø20 · T1 Ø6 mm end mill',
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
      ],
    },
    {
      wrappers: ['group'],
      props: {
        label: 'precision',
        collapsible: true,
      },
      fieldGroup: [
        {
          key: 'curveTolerance',
          type: 'number',
          defaultValue: d.curveTolerance,
          props: {
            label: 'curve precision',
            description:
              'mm: how closely SVG and text curves (fitted with arcs) and anything stretched into an ellipse are followed; circles and arcs are exact; smaller is smoother but slower',
            min: CURVE_TOLERANCE.min,
            max: CURVE_TOLERANCE.max,
            required: true,
          },
        },
        {
          key: 'geometryDecimals',
          type: 'enum',
          defaultValue: d.geometryDecimals,
          props: {
            label: 'geometry precision',
            description:
              'the smallest distance told apart: where cuts are split, edges found and points merged; finer is slower',
            required: true,
            options: [
              { value: 1, label: '0.1 mm' },
              { value: 2, label: '0.01 mm' },
              { value: 3, label: '0.001 mm' },
              { value: 4, label: '0.0001 mm' },
            ],
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
        {
          key: 'arcs',
          type: 'boolean',
          defaultValue: d.arcs,
          props: {
            label: 'write curves as arcs (G2 / G3)',
            description:
              'much shorter files and smoother motion; turn off for controllers without arc support',
          },
        },
      ],
    },
  ],
};
