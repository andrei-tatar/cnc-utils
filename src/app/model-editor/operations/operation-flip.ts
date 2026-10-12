import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { numberIn } from '../variables/field';

/**
 * Turns the board over (a two-sided job): the operations below it, up to
 * the next flip, are cut on its back (see `onBack`). They're drawn where
 * they are on the board, seen through it from the top, and cut mirrored
 * across the line it turns over along. It can drill dowel holes on that
 * line first, through the board into the spoilboard, to set it back in
 * the same place.
 */
export interface ModelType {
  type?: 'flip';
  /**
   * The line through the board's middle it turns over along (the first
   * flip's counts for every one: see `jobFlip`).
   */
  flipAlong: 'x' | 'y';
  /** Drill dowel holes on that line first, with the step's tool. */
  dowels: boolean;
  /** How far in from the board's ends the holes are (mm). */
  dowelInset: number;
  /** How far into the spoilboard they go (mm). */
  dowelDepth: number;
}

/** Whether `field`'s flip step is the first enabled one of the list. */
function isFirstFlip(field: FormlyFieldConfig): boolean {
  const first = (rootModel(field)?.operations ?? []).find(
    (o: any) => o?.type === 'flip' && !o.disabled,
  );
  return !first || first.id === field.model?.id;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'flipAlong',
      type: 'enum',
      defaultValue: 'x',
      props: {
        label: 'turn over along',
        required: true,
        options: [
          { value: 'x', label: 'X: ends stay at the ends, Y mirrored' },
          { value: 'y', label: 'Y: sides stay at the sides, X mirrored' },
        ],
        description:
          'the operations below are drawn where they are on the board, seen through it from the top, and cut mirrored for the back',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !isFirstFlip(field),
      },
    },
    {
      key: 'dowels',
      type: 'boolean',
      defaultValue: true,
      props: {
        label: 'drill dowel holes first',
        description:
          'two holes on the line it turns over along, through the board into the spoilboard: dowels in them set the board back in place',
      },
    },
    {
      key: 'dowelInset',
      type: 'number',
      defaultValue: 15,
      props: {
        label: 'holes in from the ends',
        min: 0,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !field.model?.dowels,
        'props.description': (field: FormlyFieldConfig) => {
          const inset = numberIn(field, field.model?.dowelInset) ?? 0;
          const stock = rootModel(field)?.stock;
          const along = flipOfList(field);
          const length =
            numberIn(field, along === 'y' ? stock?.height : stock?.width) ?? 0;
          return length > 0
            ? `mm from the board’s ends: ${Math.round((length - 2 * inset) * 100) / 100} mm apart`
            : 'mm from the board’s ends';
        },
      },
    },
    {
      key: 'dowelDepth',
      type: 'number',
      defaultValue: 6,
      props: {
        label: 'into the spoilboard',
        description: 'mm below the board',
        min: 0,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !field.model?.dowels,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => field.model?.type !== Definition.type,
  },
};

/** The way the list's first flip turns the board over. */
function flipOfList(field: FormlyFieldConfig): 'x' | 'y' {
  const first = (rootModel(field)?.operations ?? []).find(
    (o: any) => o?.type === 'flip' && !o.disabled,
  );
  return (first ?? field.model)?.flipAlong === 'y' ? 'y' : 'x';
}

export const Definition = {
  type: 'flip',
  label: 'turn the board over',
  fieldGroup: field,
} as const;
