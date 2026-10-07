import { FormlyFieldConfig } from '@ngx-formly/core';
import { sameWork } from './same-work';

describe('sameWork', () => {
  const fields: FormlyFieldConfig[] = [
    {
      key: 'operations',
      type: 'repeat',
      fieldArray: {
        fieldGroup: [
          { key: 'type', type: 'select' },
          { key: 'name', type: 'input' },
          {
            fieldGroup: [
              { key: 'stepover', type: 'number', defaultValue: 0.4 },
              { key: 'finish', type: 'checkbox', defaultValue: false },
            ],
          },
          { fieldGroup: [{ key: 'stepover', defaultValue: 0.1 }] },
        ],
      },
    },
    {
      key: 'gcode',
      fieldGroup: [{ key: 'arcs', type: 'checkbox', defaultValue: true }],
    },
  ];

  const model = () => ({
    operations: [{ id: 'a', type: 'pocket', stepover: 0.5, expanded: false }],
    gcode: { arcs: false },
  });

  it('holds for equal models', () => {
    expect(sameWork(model(), model(), fields)).toBeTrue();
  });

  it('ignores which items are expanded', () => {
    const expanded = model();
    expanded.operations[0].expanded = true;
    expect(sameWork(model(), expanded, fields)).toBeTrue();
  });

  it('ignores properties set to undefined', () => {
    const cleared: any = model();
    cleared.operations[0].name = undefined;
    expect(sameWork(model(), cleared, fields)).toBeTrue();
  });

  it('takes a missing field as its default, in either model', () => {
    const filled: any = model();
    filled.operations[0].finish = false;
    expect(sameWork(model(), filled, fields)).toBeTrue();
    expect(sameWork(filled, model(), fields)).toBeTrue();
  });

  it('takes any variant’s default for a shared key', () => {
    const saved: any = model();
    delete saved.operations[0].stepover;
    for (const stepover of [0.4, 0.1]) {
      const filled: any = model();
      filled.operations[0].stepover = stepover;
      expect(sameWork(saved, filled, fields))
        .withContext(`${stepover}`)
        .toBeTrue();
    }
  });

  it('sees a changed value', () => {
    const changed = model();
    changed.operations[0].stepover = 0.6;
    expect(sameWork(model(), changed, fields)).toBeFalse();
    const arcs = model();
    arcs.gcode.arcs = true;
    expect(sameWork(model(), arcs, fields)).toBeFalse();
  });

  it('sees a value set where there was none, other than the default', () => {
    const filled: any = model();
    filled.operations[0].finish = true;
    expect(sameWork(model(), filled, fields)).toBeFalse();
    const named: any = model();
    named.operations[0].name = 'roughing';
    expect(sameWork(model(), named, fields)).toBeFalse();
  });

  it('sees items added, removed or moved', () => {
    const two = model();
    two.operations.push({ ...two.operations[0], id: 'b' });
    expect(sameWork(model(), two, fields)).toBeFalse();
    expect(sameWork(two, model(), fields)).toBeFalse();
    const swapped = model();
    swapped.operations = [two.operations[1], two.operations[0]];
    expect(sameWork(two, swapped, fields)).toBeFalse();
  });
});
