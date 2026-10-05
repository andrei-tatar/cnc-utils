import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  ModelType as OperationsModelType,
  field as operationsField,
} from '../operations';

export type BitType = 'end-mill' | 'v-bit';

const hideUnlessVBit = (field: FormlyFieldConfig) =>
  field.model?.bitType !== 'v-bit';

export type ToolType = {
  id: string;
  expanded: boolean;

  name: string;
  bitType?: BitType;
  diameter: number;
  vAngle: number;
  tipDiameter: number;
  feedRate: number;
  plungeFeedRate: number;
} & OperationsModelType;

export type ModelType = {
  tools: Array<ToolType>;
};

export const field: FormlyFieldConfig = {
  key: 'tools',
  type: 'repeat',
  defaultValue: [],
  props: {
    label: 'tools',
    itemLabel: 'tool',
    accent: '#ea580c',
    collapsible: true,
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
          required: true,
        },
      },
      {
        key: 'bitType',
        type: 'enum',
        defaultValue: 'end-mill',
        props: {
          label: 'bit type',
          required: true,
          options: [
            { value: 'end-mill', label: 'end mill' },
            { value: 'v-bit', label: 'v-bit' },
          ],
        },
      },
      {
        key: 'diameter',
        type: 'number',
        defaultValue: 3,
        props: {
          label: 'diameter',
          required: true,
        },
      },
      {
        key: 'vAngle',
        type: 'number',
        defaultValue: 60,
        props: {
          min: 1,
          max: 179,
          label: 'v angle',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      {
        key: 'tipDiameter',
        type: 'number',
        defaultValue: 0,
        props: {
          min: 0,
          label: 'tip diameter',
          required: true,
        },
        expressions: { hide: hideUnlessVBit },
      },
      {
        key: 'feedRate',
        type: 'number',
        defaultValue: 1200,
        props: {
          label: 'feed rate',
          required: true,
        },
      },
      {
        key: 'plungeFeedRate',
        type: 'number',
        defaultValue: 300,
        props: {
          label: 'plunge fr',
          required: true,
        },
      },
      operationsField,
    ],
  },
};
