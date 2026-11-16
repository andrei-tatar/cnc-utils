import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * A 3D model (an STL or 3MF file), for a 3D relief to carve: placed by its
 * transforms — move, align, rotate and scale, in three dimensions — in
 * design coordinates, Z 0 the top of the stock. Where an outline is asked
 * for, it's the rectangle round it seen from above.
 */
export interface ModelType {
  type: 'model';
  /** The STL or 3MF file, as a data URL. */
  modelFile: string;
  /** Name of the file it was loaded from (display only). */
  fileName?: string;
}

const field: FormlyFieldConfig = {
  fieldGroup: [
    { key: 'fileName', type: 'hidden' },
    {
      key: 'modelFile',
      type: 'file',
      props: {
        label: 'model',
        description:
          'an STL or 3MF file, for a 3D relief to carve. Z 0 is the top of the stock: place it with move, align, rotate and scale transforms',
        accept: '.stl,.3mf',
        readAs: 'dataUrl',
        fileNameKey: 'fileName',
        required: true,
      },
    },
  ],
  expressions: {
    hide: (field: FormlyFieldConfig) => {
      return field.model?.type !== Definition.type;
    },
  },
};

export const Definition = {
  type: 'model',
  label: '3D model',
  fieldGroup: field,
} as const;

/**
 * Whether a field of a shape's transform belongs to a 3D model shape: its
 * transforms are the ones that work in three dimensions, with a Z.
 */
export function ofModelShape(field: FormlyFieldConfig | undefined): boolean {
  for (let f = field; f; f = f.parent) {
    if (Array.isArray(f.model?.transforms)) {
      return f.model.type === Definition.type;
    }
  }
  return false;
}
