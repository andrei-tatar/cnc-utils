import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Where an image (or a relief) goes on its operation's shape: turned, fitted
 * to the shape's bounding box, scaled, aligned and moved (the keys
 * `imageLayoutOf` in `pipeline/vcarve-source.ts` reads).
 */
export function imagePlacementField(
  label = 'image placement',
): FormlyFieldConfig {
  return {
    wrappers: ['group'],
    props: {
      label,
      description: 'on the shape’s bounding box; the shape’s outline clips it',
      collapsible: true,
      // Open when it's been moved off the default, so it isn't missed.
      startOpen: (model: any) =>
        (model?.imageScale ?? 100) !== 100 ||
        (model?.imageAlignX ?? 'center') !== 'center' ||
        (model?.imageAlignY ?? 'middle') !== 'middle' ||
        !!model?.imageOffsetX ||
        !!model?.imageOffsetY ||
        !!model?.imageRotation,
    },
    fieldGroup: [
      {
        key: 'imageRotation',
        type: 'enum',
        defaultValue: 0,
        props: {
          label: 'turned',
          required: true,
          options: [
            { value: 0, label: 'as it is' },
            { value: 90, label: '90° clockwise' },
            { value: 180, label: '180°' },
            { value: 270, label: '90° anticlockwise' },
          ],
        },
      },
      {
        key: 'imageFit',
        type: 'enum',
        defaultValue: 'contain',
        props: {
          label: 'fit',
          required: true,
          options: [
            { value: 'contain', label: 'whole image inside' },
            { value: 'cover', label: 'cover, cropping the image' },
            { value: 'stretch', label: 'stretch' },
          ],
        },
      },
      {
        key: 'imageScale',
        type: 'number',
        defaultValue: 100,
        props: {
          label: 'scale',
          description: '% of the fitted size',
          min: 0.1,
          required: true,
        },
      },
      {
        key: 'imageAlignX',
        type: 'enum',
        defaultValue: 'center',
        props: {
          label: 'align across',
          required: true,
          options: [
            { value: 'left', label: 'left' },
            { value: 'center', label: 'centre' },
            { value: 'right', label: 'right' },
          ],
        },
      },
      {
        key: 'imageAlignY',
        type: 'enum',
        defaultValue: 'middle',
        props: {
          label: 'align up',
          required: true,
          options: [
            { value: 'bottom', label: 'bottom' },
            { value: 'middle', label: 'middle' },
            { value: 'top', label: 'top' },
          ],
        },
      },
      {
        key: 'imageOffsetX',
        type: 'number',
        defaultValue: 0,
        props: {
          label: 'move X',
          description: 'mm',
          required: true,
        },
      },
      {
        key: 'imageOffsetY',
        type: 'number',
        defaultValue: 0,
        props: {
          label: 'move Y',
          description: 'mm',
          required: true,
        },
      },
    ],
  };
}

/** The placement fields' values (see `imagePlacementField`). */
export type ImagePlacementModel = {
  /** How the image fills the shape's bounding box. */
  imageFit: 'contain' | 'cover' | 'stretch';
  /** Percent of the fitted size. */
  imageScale: number;
  /** Which side of the box the image keeps to. */
  imageAlignX: 'left' | 'center' | 'right';
  imageAlignY: 'bottom' | 'middle' | 'top';
  /** Moved this far from there (mm). */
  imageOffsetX: number;
  imageOffsetY: number;
  /** Turned clockwise first: 0, 90, 180 or 270 (degrees). */
  imageRotation?: number;
};
