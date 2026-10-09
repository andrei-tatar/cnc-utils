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
const onRotary = (field: FormlyFieldConfig) => field.model?.mount === 'rotary';
/** A round blank: only on a rotary axis. */
const isCylinder = (field: FormlyFieldConfig) =>
  onRotary(field) && field.model?.shape === 'cylinder';
/** Whether a cylinder's diameter stands for its size along `axis`. */
const roundAcross = (field: FormlyFieldConfig, axis: 'x' | 'y' | 'z') =>
  isCylinder(field) &&
  (axis === 'z' || (field.model?.rotaryAlong === 'y' ? 'x' : 'y') === axis);

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
      key: 'mount',
      type: 'enum',
      defaultValue: d.mount,
      props: {
        label: 'held',
        required: true,
        options: [
          { value: 'table', label: 'on the table' },
          { value: 'rotary', label: 'on a rotary axis (4th axis)' },
        ],
      },
      expressions: {
        hide: hideUnlessStock,
        'props.description': (field: FormlyFieldConfig) =>
          onRotary(field)
            ? 'centred on the axis; each operation can turn it first'
            : '',
      },
    },
    {
      key: 'rotaryAlong',
      type: 'enum',
      defaultValue: d.rotaryAlong,
      props: {
        label: 'axis along',
        description: 'the machine axis the rotary axis is parallel to',
        required: true,
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
        ],
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || !onRotary(field),
      },
    },
    {
      key: 'shape',
      type: 'enum',
      defaultValue: d.shape,
      props: {
        label: 'shape',
        required: true,
        options: [
          { value: 'box', label: 'a box (square or rectangular)' },
          { value: 'cylinder', label: 'a cylinder (round)' },
        ],
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || !onRotary(field),
      },
    },
    {
      key: 'diameter',
      type: 'number',
      defaultValue: d.diameter,
      props: {
        label: 'diameter',
        description: 'mm; its length is set along the axis',
        min: 0,
        required: true,
      },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || !isCylinder(field),
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
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || roundAcross(field, 'x'),
        // A cylinder's only other size is along the axis.
        'props.label': (field: FormlyFieldConfig) =>
          isCylinder(field) ? 'length' : 'width',
      },
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
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || roundAcross(field, 'y'),
        // A cylinder's only other size is along the axis.
        'props.label': (field: FormlyFieldConfig) =>
          isCylinder(field) ? 'length' : 'height',
      },
    },
    {
      key: 'thickness',
      type: 'number',
      defaultValue: d.thickness,
      props: { label: 'thickness', description: 'mm', min: 0, required: true },
      expressions: {
        hide: (field: FormlyFieldConfig) =>
          hideUnlessStock(field) || roundAcross(field, 'z'),
      },
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
      },
      expressions: {
        hide: hideUnlessStock,
        // The bottom on a rotary axis, or the axis on the table, read as
        // the other (see `stockOffset`).
        'props.options': (field: FormlyFieldConfig) => [
          { value: 'top', label: 'the top of the stock' },
          onRotary(field)
            ? { value: 'axis', label: 'the rotary axis' }
            : { value: 'bottom', label: 'the bottom (spoilboard)' },
        ],
      },
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
