import { GCodeBuilder } from '../../cam/gcode-builder';
import { DEFAULT_GCODE_OPTIONS } from '../../cam/gcode-options';
import { emptyModel, ModelType } from '../model-editor/model';
import {
  buildProgram,
  buildProgramPerTool,
  operationDescriptions,
  Program,
} from './gcode';

function operation(id: string, toolNumber: number): GCodeBuilder {
  return new GCodeBuilder()
    .useTool(toolNumber, `tool ${toolNumber}`)
    .sourceOperationId(id)
    .travelTo(0, 0)
    .plunge(-1)
    .carveTo(10, 0);
}

function program(operationComments = true): Program {
  return {
    builders: [operation('a', 1), new GCodeBuilder(), operation('b', 2)],
    options: { ...DEFAULT_GCODE_OPTIONS, operationComments },
  };
}

const descriptions = { a: 'Operation 1: first', b: 'Operation 2: second' };

describe('operation comments', () => {
  it('describes each operation before its G-code', () => {
    const lines = buildProgram(program(), undefined, descriptions).split('\n');
    const first = lines.indexOf('; Operation 1: first');
    const second = lines.indexOf('; Operation 2: second');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    // Before the tool change, so it reads as the heading of what follows.
    expect(lines.indexOf('T1 M6')).toBeGreaterThan(first);
    expect(lines.indexOf('T2 M6')).toBeGreaterThan(second);
  });

  it('leaves them out when the option is off, or nothing is described', () => {
    const off = buildProgram(program(false), undefined, descriptions);
    expect(off).not.toContain('Operation');
    expect(buildProgram(program())).not.toContain('Operation');
  });

  it('describes the operations in each file per tool', () => {
    const files = buildProgramPerTool(program(), undefined, descriptions);
    expect(files.length).toBe(2);
    expect(files[0].gcode).toContain('; Operation 1: first');
    expect(files[0].gcode).not.toContain('Operation 2');
    expect(files[1].gcode).toContain('; Operation 2: second');
  });

  it('numbers operations, with their names and what they cut', () => {
    const model: ModelType = {
      ...emptyModel(),
      shapes: [
        { id: 's', type: 'circle', diameter: 20, transforms: [] },
      ] as any,
      tools: [{ id: 't', index: 1, bitType: 'end-mill', diameter: 6 }] as any,
      operations: [
        { id: 'a', type: 'drill', shapeId: 's', toolId: 't', depth: 3 },
        {
          id: 'b',
          type: 'drill',
          name: 'holes',
          shapeId: 's',
          toolId: 't',
          depth: 3,
        },
      ] as any,
    };
    const result = operationDescriptions(model);
    expect(result['a']).toMatch(/^Operation 1: drill 3 mm · circle Ø20 · T1 /);
    expect(result['b']).toMatch(/^Operation 2: holes \(drill 3 mm · /);
  });
});
