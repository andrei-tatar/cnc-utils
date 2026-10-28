import { FormlyFieldConfig } from '@ngx-formly/core';
import { rootModel } from '../shapes/describe';
import { resolvedModelOf } from '../variables/field';
import { TEXT_SETTINGS, TextSettings, textSettingsFields } from './settings';

/**
 * Text settings kept once and used by any number of text shapes (a shape's
 * `textStyleId`), so changing the style changes every text set in it.
 */
export type TextStyleType = {
  id: string;
  expanded: boolean;
  name?: string;
} & TextSettings;

export type ModelType = {
  textStyles: TextStyleType[];
};

/** What a text shape holds about the style it's set in. */
export type TextStyleChoice = {
  /** The style it's set in; its own settings without one. */
  textStyleId?: string | null;
  /** Its cap height when not the style's (mm; empty: the style's). */
  sizeOverride?: number | null;
};

/** All text styles in the model, from any field in the form. */
export function allTextStyles(
  field: FormlyFieldConfig | undefined,
): TextStyleType[] {
  return rootModel(field)?.textStyles ?? [];
}

/** A readable name built from the style's settings, e.g. "Roboto 700 20 mm". */
export function describeTextStyle(
  style: Partial<TextSettings> | undefined,
): string {
  const parts: string[] = [style?.font?.family ?? 'text'];
  if (style?.fontWeight && style.fontWeight !== 400) {
    parts.push(`${style.fontWeight}`);
  }
  if (style?.fontStyle === 'italic') {
    parts.push('italic');
  }
  if (typeof style?.size === 'number') {
    parts.push(`${style.size} mm`);
  }
  return parts.join(' ');
}

/** The style's own name, or one built from its settings. */
export function textStyleLabel(style: Partial<TextStyleType> | undefined) {
  return style?.name || describeTextStyle(style);
}

/**
 * A shape as it's made: a text shape set in a style takes the style's
 * settings (its cap height unless it overrides it). One whose style is
 * gone has no font, so it comes out empty. Other shapes are as they are.
 */
export function withTextStyle<T extends { type: string }>(
  shape: T,
  styles: readonly TextStyleType[] | undefined,
): T {
  if (shape.type !== 'text') {
    return shape;
  }
  const { textStyleId, sizeOverride, ...own }: any = shape;
  if (!textStyleId) {
    return own as T;
  }
  const style = styles?.find((s) => s.id === textStyleId);
  if (!style) {
    return { ...own, font: undefined } as T;
  }
  const settings = Object.fromEntries(
    TEXT_SETTINGS.map((key) => [key, style[key]]),
  ) as TextSettings;
  if (typeof sizeOverride === 'number' && sizeOverride > 0) {
    settings.size = sizeOverride;
  }
  return { ...own, ...settings } as T;
}

export const field: FormlyFieldConfig = {
  key: 'textStyles',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'text styles',
    itemLabel: 'text style',
    describeItem: describeTextStyle,
    accent: '#db2777',
    collapsible: true,
    clonable: true,
    description:
      'Font settings set once and used by text shapes (their “style”): changing one changes every text set in it.',
  },
  fieldArray: {
    fieldGroup: [
      {
        key: 'id',
        type: 'hidden',
      },
      {
        key: 'expanded',
        type: 'hidden',
        defaultValue: false,
      },
      {
        key: 'name',
        type: 'input',
        props: {
          label: 'name',
        },
        expressions: {
          'props.placeholder': (field: FormlyFieldConfig) =>
            describeTextStyle(resolvedModelOf(field)),
        },
      },
      ...textSettingsFields(),
    ],
  },
};
