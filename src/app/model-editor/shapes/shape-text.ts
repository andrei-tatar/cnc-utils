import { FormlyFieldConfig } from '@ngx-formly/core';
import { AbstractControl } from '@angular/forms';
import { TextSettings, textSettingsFields } from '../text-styles/settings';
import { allTextStyles, TextStyleChoice, textStyleLabel } from '../text-styles';
import { numberIn } from '../variables/field';

export type ModelType = {
  type: 'text';
  text: string;
} & TextSettings &
  TextStyleChoice;

const hideUnlessText = (field: FormlyFieldConfig) =>
  field.model?.type !== Definition.type;

const inStyle = (field: FormlyFieldConfig) => !!field.model?.textStyleId;

/** The style the text shape `field` belongs to is set in. */
function styleOf(field: FormlyFieldConfig) {
  return allTextStyles(field).find((s) => s.id === field.model?.textStyleId);
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'text',
      type: 'textarea',
      defaultValue: 'Hello',
      props: {
        label: 'text',
        rows: 3,
        required: true,
      },
    },
    {
      key: 'textStyleId',
      type: 'enum',
      props: {
        label: 'text style',
        placeholder: 'own settings',
        description: 'set in a text style, or in its own font settings',
      },
      validators: {
        textStyleExists: {
          expression: (control: AbstractControl, field: FormlyFieldConfig) =>
            !control.value ||
            allTextStyles(field).some((s) => s.id === control.value),
          message: 'This text style was deleted — pick another one',
        },
      },
      expressions: {
        // Only once there are styles to pick from.
        hide: (field: FormlyFieldConfig) =>
          !allTextStyles(field).length && !inStyle(field),
        'props.options': (field: FormlyFieldConfig) =>
          allTextStyles(field).map((style) => ({
            value: style.id,
            label: textStyleLabel({
              ...style,
              size: numberIn(field, style.size) as number,
            }),
          })),
      },
    },
    ...textSettingsFields(inStyle),
    {
      key: 'sizeOverride',
      type: 'number',
      props: {
        min: 0,
        label: 'cap height',
        description: 'mm; empty uses the text style’s',
      },
      expressions: {
        hide: (field: FormlyFieldConfig) => !inStyle(field),
        'props.placeholder': (field: FormlyFieldConfig) => {
          const size = numberIn(field, styleOf(field)?.size);
          return size === undefined ? '' : `${size} (the style’s)`;
        },
      },
    },
  ],
  expressions: {
    hide: hideUnlessText,
  },
};

export const Definition = {
  type: 'text',
  label: 'text',
  fieldGroup: field,
} as const;
