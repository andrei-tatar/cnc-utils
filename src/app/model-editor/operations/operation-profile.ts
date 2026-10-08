import { FormlyFieldConfig } from '@ngx-formly/core';
import { DepthSteps, depthStepsFields } from './depth-steps';
import { numberIn } from '../variables/field';

export interface ModelType extends DepthSteps {
  type?: 'profile';
  /** Which part of the shape to profile (see ShapePart). */
  mode?: 'both' | 'holes' | 'contours';
  side: 'outside' | 'inside' | 'on-line';
  direction: 'climb' | 'conventional';
  /** Material left on the wall for a finishing pass (mm); not on line. */
  leaveStock?: number;
  /**
   * After the other passes, one more at full depth on the line itself,
   * taking off what `leaveStock` left.
   */
  finishPass?: boolean;
  /**
   * The passes stop this much (mm) above the full depth, and a last pass
   * goes through that skin once every path is cut, so parts stay held.
   */
  onionSkin?: number;
  /**
   * Radius (mm) of an arc into and out of each loop on the waste side, so
   * the bit doesn't start or stop against the finished wall; 0 for none.
   */
  leadIn?: number;
}

const hideUnlessProfile = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const hideUnlessOffset = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type || field.model?.side === 'on-line';

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'mode',
      type: 'enum',
      defaultValue: 'both',
      props: {
        label: 'profile',
        required: true,
        options: [
          { value: 'both', label: 'outlines and holes' },
          { value: 'holes', label: 'holes only' },
          { value: 'contours', label: 'outlines only, holes ignored' },
        ],
      },
    },
    {
      key: 'side',
      type: 'enum',
      defaultValue: 'outside',
      props: {
        label: 'side',
        required: true,
        options: [
          { value: 'outside', label: 'outside' },
          { value: 'inside', label: 'inside' },
          { value: 'on-line', label: 'on line' },
        ],
      },
    },
    {
      key: 'leaveStock',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'leave stock',
        required: true,
      },
      expressions: { hide: hideUnlessOffset },
    },
    {
      key: 'finishPass',
      type: 'boolean',
      defaultValue: false,
      props: {
        label: 'finishing pass: take the stock off at full depth, last',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessOffset(field) ||
          !((numberIn(field, field.model?.leaveStock) ?? 0) > 0),
      },
    },
    {
      key: 'leadIn',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'lead in / out',
        description:
          'mm, radius of an arc into and out of each loop, on the waste side (inside holes); 0 for none',
        required: true,
      },
      expressions: { hide: hideUnlessOffset },
    },
    {
      key: 'direction',
      type: 'enum',
      defaultValue: 'climb',
      props: {
        label: 'direction',
        required: true,
        options: [
          { value: 'climb', label: 'climb' },
          { value: 'conventional', label: 'conventional' },
        ],
      },
    },
    ...depthStepsFields(),
    {
      key: 'onionSkin',
      type: 'number',
      defaultValue: 0,
      props: {
        min: 0,
        label: 'onion skin',
        description:
          'mm left at the bottom, cut through in a last pass once every path is cut (keeps parts in place); 0 for none',
        required: true,
      },
    },
  ],
  expressions: {
    hide: hideUnlessProfile,
  },
};

export const Definition = {
  type: 'profile',
  label: 'profile',
  fieldGroup: field,
} as const;
