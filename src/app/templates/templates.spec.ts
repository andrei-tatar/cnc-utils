import { groupTemplates, listTemplates, loadTemplate, Template } from '.';
import { borrowedShapeId } from '../model-editor/operations/describe';
import { flatOperations } from '../model-editor/operations/flatten';

// Needs templates/index.json: `npm test` writes it first (or `npm run templates`).
describe('templates', () => {
  let templates: Template[];

  beforeAll(async () => {
    templates = await listTemplates();
  });

  it('are listed', () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it('are listed under their headings, each heading once', () => {
    const groups = groupTemplates(templates);
    expect(groups.every((g) => g.group && g.templates.length)).toBeTrue();
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length);
    expect(groups.flatMap((g) => g.templates)).toEqual(templates);
  });

  it('each hold a project with unique ids', async () => {
    for (const template of templates) {
      const model: any = await loadTemplate(template);
      for (const key of ['variables', 'shapes', 'tools', 'operations']) {
        expect(Array.isArray(model[key]))
          .withContext(`${template.file} ${key}`)
          .toBeTrue();
      }
      const ids = [
        ...model.variables,
        ...model.shapes,
        ...model.shapes.flatMap((s: any) => s.transforms ?? []),
        ...model.tools,
        ...flatOperations(model.operations),
      ].map((item: any) => item.id);
      expect(new Set(ids).size).withContext(template.file).toBe(ids.length);
    }
  });

  it('each give every tool its own index', async () => {
    for (const template of templates) {
      const model: any = await loadTemplate(template);
      const indexes = model.tools.map((tool: any) => tool.index);
      for (const index of indexes) {
        expect(Number.isInteger(index) && index >= 1)
          .withContext(`${template.file} tool index ${index}`)
          .toBeTrue();
      }
      expect(new Set(indexes).size)
        .withContext(template.file)
        .toBe(indexes.length);
    }
  });

  it('each only refer to tools, shapes and operations they have', async () => {
    for (const template of templates) {
      const model: any = await loadTemplate(template);
      const has = (list: any[], id: string) =>
        list.some((item) => item.id === id);
      const operations: any[] = flatOperations(model.operations);
      for (const op of operations) {
        const where = `${template.file} ${op.id}`;
        // Rotate steps and rotary repeats cut nothing: no tool or shape.
        if (op.type === 'rotate') {
          expect(typeof op.angle)
            .withContext(`${where} angle`)
            .toBe('number');
          continue;
        }
        if (op.type === 'rotary-repeat') {
          expect(op.operations?.length)
            .withContext(`${where} operations`)
            .toBeGreaterThan(0);
          continue;
        }
        expect(has(model.tools, op.toolId))
          .withContext(`${where} tool`)
          .toBeTrue();
        // Its own, or (clearings, plugs) the one it borrows.
        expect(has(model.shapes, borrowedShapeId(op, operations)!))
          .withContext(`${where} shape`)
          .toBeTrue();
        for (const key of ['vcarveOperationId', 'pocketOperationId']) {
          if (op[key] !== undefined) {
            expect(has(operations, op[key]))
              .withContext(`${where} ${key}`)
              .toBeTrue();
          }
        }
      }
    }
  });
});
