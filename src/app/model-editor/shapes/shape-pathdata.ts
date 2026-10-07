import { FormlyFieldConfig } from '@ngx-formly/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import type { HeaderAction } from '../components/array-type-component';
import { resolvedItem } from '../variables/field';
import {
  parametersOf,
  PathCommand,
  PathFlag,
  PathParameter,
  pathCommandsData,
} from '../../../cam/path-commands';

/** One drawing instruction: each number a number or an expression. */
export type PathCommandItem = { id: string } & PathCommand;

export interface ModelType {
  type: 'path-data';
  /** SVG path commands, in order. */
  pathCommands: PathCommandItem[];
}

const COMMANDS: Array<{ value: string; label: string }> = [
  { value: 'M', label: 'M move to' },
  { value: 'm', label: 'm move by' },
  { value: 'L', label: 'L line to' },
  { value: 'l', label: 'l line by' },
  { value: 'H', label: 'H horizontal to' },
  { value: 'h', label: 'h horizontal by' },
  { value: 'V', label: 'V vertical to' },
  { value: 'v', label: 'v vertical by' },
  { value: 'C', label: 'C curve to' },
  { value: 'c', label: 'c curve by' },
  { value: 'S', label: 'S smooth curve to' },
  { value: 's', label: 's smooth curve by' },
  { value: 'Q', label: 'Q quadratic to' },
  { value: 'q', label: 'q quadratic by' },
  { value: 'T', label: 'T smooth quadratic to' },
  { value: 't', label: 't smooth quadratic by' },
  { value: 'A', label: 'A arc to' },
  { value: 'a', label: 'a arc by' },
  { value: 'Z', label: 'Z close' },
];

/** Shown only for the commands that take it. */
const takes = (name: PathParameter | PathFlag) => (field: FormlyFieldConfig) =>
  !parametersOf(field.model?.command).includes(name);

function parameterField(
  name: PathParameter,
  label: string,
  defaultValue = 0,
): FormlyFieldConfig {
  return {
    key: name,
    type: 'number',
    className: `path-parameter path-parameter--${name}`,
    defaultValue,
    props: {
      placeholder: label,
      required: true,
      attributes: { 'aria-label': label },
    },
    expressions: { hide: takes(name) },
  };
}

function flagField(name: PathFlag, label: string): FormlyFieldConfig {
  return {
    key: name,
    type: 'boolean',
    className: 'path-flag',
    defaultValue: false,
    props: { label },
    expressions: { hide: takes(name) },
  };
}

const importPathData: HeaderAction = {
  label: 'Import',
  title: 'Import SVG path data: replaces the commands',
  icon: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10',
  async run({ injector, field, items, replace }) {
    const { PathDataDialogComponent } =
      await import('../components/path-data-dialog.component');
    const ref = injector.get(NgbModal).open(PathDataDialogComponent, {
      centered: true,
      size: 'lg',
      ariaLabelledBy: 'path-data-title',
    });
    Object.assign(ref.componentInstance, {
      // The current path, expressions worked out, to copy or edit.
      initialText: pathCommandsData(
        items.map((item) => resolvedItem(field, item)),
      ),
      replacing: items.length,
    });
    const commands: PathCommand[] | undefined = await ref.result.catch(
      () => undefined,
    );
    if (commands) {
      await replace(commands);
    }
  },
};

const field: FormlyFieldConfig = {
  fieldGroup: [
    {
      key: 'pathCommands',
      type: 'repeat',
      defaultValue: [
        { id: 'c0', command: 'M', x: 0, y: 0 },
        { id: 'c1', command: 'L', x: 100, y: 0 },
        { id: 'c2', command: 'L', x: 100, y: 100 },
        { id: 'c3', command: 'L', x: 0, y: 100 },
        { id: 'c4', command: 'Z' },
      ],
      props: {
        label: 'commands',
        itemLabel: 'command',
        inline: true,
        description:
          'SVG path commands, in order: upper case to a point, lower case by an offset from the last one.',
        headerActions: [importPathData],
      },
      fieldArray: {
        fieldGroupClassName: 'path-command-row',
        fieldGroup: [
          {
            key: 'id',
            type: 'hidden',
            className: 'd-none',
          },
          {
            key: 'command',
            type: 'enum',
            className: 'path-command',
            defaultValue: 'L',
            props: {
              required: true,
              attributes: { 'aria-label': 'command' },
              options: COMMANDS,
            },
          },
          parameterField('rx', 'rx', 10),
          parameterField('ry', 'ry', 10),
          parameterField('rotation', 'rotation'),
          flagField('largeArc', 'large arc'),
          flagField('sweep', 'sweep'),
          parameterField('x1', 'x1'),
          parameterField('y1', 'y1'),
          parameterField('x2', 'x2'),
          parameterField('y2', 'y2'),
          parameterField('x', 'x'),
          parameterField('y', 'y'),
        ],
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
  type: 'path-data',
  label: 'path data',
  fieldGroup: field,
} as const;
