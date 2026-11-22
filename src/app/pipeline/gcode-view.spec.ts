import { GCodeBuilder } from '../../cam/gcode-builder';
import { DEFAULT_GCODE_OPTIONS } from '../../cam/gcode-options';
import { buildProgram, Program } from './gcode';
import { gcodeView } from './gcode-view';

function operation(id: string, toolNumber: number): GCodeBuilder {
  return new GCodeBuilder()
    .useTool(toolNumber, `tool ${toolNumber}`)
    .sourceOperationId(id)
    .travelTo(0, 0)
    .plunge(-1)
    .carveTo(10, 0);
}

const descriptions = { a: 'Operation 1: first', b: 'Operation 2: second' };

function program(builders: GCodeBuilder[]): Program {
  return { builders, options: { ...DEFAULT_GCODE_OPTIONS } };
}

describe('gcodeView', () => {
  it('shows the program as downloaded, less the project', () => {
    const job = program([operation('a', 1), operation('b', 2)]);
    expect(gcodeView(job, descriptions).listing.lines.join('\n')).toBe(
      buildProgram(job, undefined, descriptions),
    );
  });

  it('starts each operation at the comment describing it', () => {
    const job = program([operation('a', 1), operation('b', 2)]);
    const { listing, sections } = gcodeView(job, descriptions);
    const named = sections.filter((s) => s.label);
    expect(named.map((s) => s.label)).toEqual([
      'Operation 1: first',
      'Operation 2: second',
    ]);
    for (const section of named) {
      expect(listing.lines[section.first]).toBe(`; ${section.label}`);
    }
    // Every line in one stretch, in order.
    expect(sections[0].first).toBe(0);
    sections.slice(1).forEach((section, i) => {
      expect(section.first).toBe(sections[i].last + 1);
    });
    expect(sections[sections.length - 1].last).toBe(listing.lines.length - 1);
  });

  it('gives an operation cut again right after itself a stretch each time', () => {
    const job = program([operation('a', 1), operation('a', 1)]);
    const named = gcodeView(job, descriptions).sections.filter((s) => s.label);
    expect(named.map((s) => s.operationId)).toEqual(['a', 'a']);
    expect(named[1].first).toBe(named[0].last + 1);
  });
});
