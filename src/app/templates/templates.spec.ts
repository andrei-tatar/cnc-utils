import { listTemplates, loadTemplate, Template } from '.';
import { borrowedShapeId } from '../model-editor/operations/describe';

// Needs templates/index.json: `npm test` writes it first (or `npm run templates`).
describe('templates', () => {
  let templates: Template[];

  beforeAll(async () => {
    templates = await listTemplates();
  });

  it('are listed', () => {
    expect(templates.length).toBeGreaterThan(0);
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
        ...model.operations,
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
      for (const op of model.operations) {
        const where = `${template.file} ${op.id}`;
        expect(has(model.tools, op.toolId))
          .withContext(`${where} tool`)
          .toBeTrue();
        // Its own, or (clearings, plugs) the one it borrows.
        expect(has(model.shapes, borrowedShapeId(op, model.operations)!))
          .withContext(`${where} shape`)
          .toBeTrue();
        for (const key of ['vcarveOperationId', 'pocketOperationId']) {
          if (op[key] !== undefined) {
            expect(has(model.operations, op[key]))
              .withContext(`${where} ${key}`)
              .toBeTrue();
          }
        }
      }
    }
  });
});
