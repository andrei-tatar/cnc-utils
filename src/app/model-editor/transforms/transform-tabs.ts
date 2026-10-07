import { FormlyFieldConfig } from '@ngx-formly/core';
import { PointItem, pointListField } from '../point-list';

/**
 * Tabs on the shape's loops: material every operation leaves standing below
 * a depth (see `src/cam/tabs.ts`). They follow the shape through the
 * transforms after this one, so a repeat after it copies them too.
 */
export interface ModelType {
  type: 'tabs';
  /** Which loops get tabs: outlines, holes or both. */
  tabsOn: 'contours' | 'holes' | 'both';
  /** Which way they reach from the line (away from the shape's area, …). */
  tabSide: 'outside' | 'inside' | 'both';
  /** Spaced evenly round each loop, or at given points. Missing: evenly. */
  tabPlacement?: 'evenly' | 'points';
  /** A tab on the line nearest each. */
  tabPoints?: PointItem[];
  tabCount: number;
  tabWidth: number;
  tabLength: number;
  /** How deep the tabs' top is (mm below the surface). */
  tabDepth: number;
  /** Moves the tabs round each loop (mm). */
  tabOffset: number;
}

const hideUnlessTabs = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;
const atPoints = (field: FormlyFieldConfig) =>
  field.model?.tabPlacement === 'points';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'tabsOn',
      type: 'enum',
      defaultValue: 'contours',
      props: {
        label: 'on',
        required: true,
        options: [
          { value: 'contours', label: 'outlines' },
          { value: 'holes', label: 'holes' },
          { value: 'both', label: 'outlines and holes' },
        ],
      },
    },
    {
      key: 'tabSide',
      type: 'enum',
      defaultValue: 'outside',
      props: {
        label: 'side',
        description:
          'outside: away from the shape (out of an outline, into a hole)',
        required: true,
        options: [
          { value: 'outside', label: 'outside' },
          { value: 'inside', label: 'inside' },
          { value: 'both', label: 'both sides' },
        ],
      },
    },
    {
      key: 'tabPlacement',
      type: 'enum',
      defaultValue: 'evenly',
      props: {
        label: 'placed',
        required: true,
        options: [
          { value: 'evenly', label: 'evenly round each loop' },
          { value: 'points', label: 'at points' },
        ],
      },
    },
    {
      ...pointListField('tabPoints', {
        description:
          'mm; each tab goes on the line nearest its point. ' +
          'The preview shows the coordinates under the cursor.',
      }),
      expressions: {
        // A list's own model is the list: the placement is on its parent's.
        hide: (field: FormlyFieldConfig) => !atPoints(field.parent ?? field),
      },
    },
    {
      key: 'tabCount',
      type: 'number',
      defaultValue: 4,
      props: {
        label: 'count',
        description: 'on each loop',
        min: 1,
        required: true,
      },
      validators: { validation: ['whole-number'] },
      expressions: { hide: atPoints },
    },
    {
      key: 'tabWidth',
      type: 'number',
      defaultValue: 6,
      props: {
        label: 'width',
        description: 'mm along the line',
        min: 0,
        required: true,
      },
    },
    {
      key: 'tabLength',
      type: 'number',
      defaultValue: 10,
      props: {
        label: 'length',
        description:
          'mm across the line, each way; at least the widest bit cutting by it',
        min: 0,
        required: true,
      },
    },
    {
      key: 'tabDepth',
      type: 'number',
      defaultValue: 15,
      props: {
        label: 'top at depth',
        description: 'mm below the surface; nothing cuts the tabs below it',
        min: 0,
        required: true,
      },
    },
    {
      key: 'tabOffset',
      type: 'number',
      defaultValue: 0,
      props: {
        label: 'offset',
        description: 'mm round each loop, from its start; moves all the tabs',
        required: true,
      },
      expressions: { hide: atPoints },
    },
  ],
  expressions: { hide: hideUnlessTabs },
};

export const Definition = {
  type: 'tabs',
  label: 'tabs',
  fieldGroup: field,
} as const;
