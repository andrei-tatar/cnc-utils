import { FormlyFieldConfig } from '@ngx-formly/core';
import { DEFAULT_STOCK, StockOptions } from '../../../cam/stock';
import { WoodGroup, WOODS } from '../../../cam/feeds-speeds';
import { EditorState } from '../editor-state';

const WOOD_GROUPS: Record<WoodGroup, string> = {
  softwood: 'softwoods',
  hardwood: 'hardwoods',
  exotic: 'exotics',
  sheet: 'sheet goods',
};

export type ModelType = {
  stock: StockOptions;
};

const d = DEFAULT_STOCK;
const hideUnlessStock = (field: FormlyFieldConfig) => !field.model?.enabled;

/** Turning the stock on sizes it round every operation's cuts. */
function fitStock(field: FormlyFieldConfig, event?: Event) {
  // The change event comes before the control takes the new value.
  if ((event?.target as HTMLInputElement | undefined)?.checked) {
    (field.options?.formState as Partial<EditorState>)?.fitStock?.();
  }
}

export const field: FormlyFieldConfig = {
  key: 'stock',
  type: 'section',
  defaultValue: {},
  props: {
    label: 'stock',
    accent: '#a16207',
  },
  fieldGroup: [
    {
      key: 'enabled',
      type: 'boolean',
      defaultValue: d.enabled,
      props: {
        label: 'set the stock size (shown, and cuts checked against it)',
        description: 'turning it on fits the stock round every operation',
        change: fitStock,
      },
    },
    {
      key: 'width',
      type: 'number',
      defaultValue: d.width,
      props: {
        label: 'width',
        description: 'mm, along X',
        min: 0,
        required: true,
      },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'height',
      type: 'number',
      defaultValue: d.height,
      props: {
        label: 'height',
        description: 'mm, along Y',
        min: 0,
        required: true,
      },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'thickness',
      type: 'number',
      defaultValue: d.thickness,
      props: { label: 'thickness', description: 'mm', min: 0, required: true },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'x',
      type: 'number',
      defaultValue: d.x,
      props: {
        label: 'corner x',
        description: 'where the stock’s bottom-left corner is',
        required: true,
      },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'y',
      type: 'number',
      defaultValue: d.y,
      props: { label: 'corner y', required: true },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'zZero',
      type: 'enum',
      defaultValue: d.zZero,
      props: {
        label: 'Z0 at',
        required: true,
        options: [
          { value: 'top', label: 'the top of the stock' },
          { value: 'bottom', label: 'the bottom (spoilboard)' },
        ],
      },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'xyZero',
      type: 'enum',
      defaultValue: d.xyZero,
      props: {
        label: 'X0 Y0 at',
        required: true,
        options: [
          { value: 'design', label: 'the design’s origin' },
          { value: 'xmin-ymin', label: 'the stock’s bottom-left corner' },
          { value: 'xcenter-ycenter', label: 'the middle of the stock' },
          { value: 'xmax-ymin', label: 'the stock’s bottom-right corner' },
          { value: 'xmin-ymax', label: 'the stock’s top-left corner' },
          { value: 'xmax-ymax', label: 'the stock’s top-right corner' },
        ],
      },
      expressions: { hide: hideUnlessStock },
    },
    {
      key: 'material',
      type: 'enum',
      defaultValue: d.material,
      props: {
        label: 'wood',
        description: 'what the feeds & speeds calculator cuts',
        required: true,
        options: WOODS.map((wood) => ({
          value: wood.id,
          label: wood.name,
          group: WOOD_GROUPS[wood.group],
        })),
      },
    },
  ],
};
