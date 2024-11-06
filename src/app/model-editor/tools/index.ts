import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  ModelType as OperationsModelType,
  field as operationsField,
} from '../operations';

export type ToolType = {
  id: string;
  expanded: boolean;

  name: string;
  diameter: number;
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
        key: 'diameter',
        type: 'number',
        defaultValue: 3,
        props: {
          label: 'diameter',
          required: true,
        },
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
