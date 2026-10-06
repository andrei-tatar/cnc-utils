import { listTemplates, loadTemplate, Template } from '.';

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
        expect(has(model.shapes, op.shapeId))
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
