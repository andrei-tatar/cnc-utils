import { listSamples, loadSample, Sample } from '.';

// Needs samples/index.json: `npm test` writes it first (or `npm run samples`).
describe('samples', () => {
  let samples: Sample[];

  beforeAll(async () => {
    samples = await listSamples();
  });

  it('are listed', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it('each hold a project with unique ids', async () => {
    for (const sample of samples) {
      const model: any = await loadSample(sample);
      for (const key of ['variables', 'shapes', 'tools', 'operations']) {
        expect(Array.isArray(model[key]))
          .withContext(`${sample.file} ${key}`)
          .toBeTrue();
      }
      const ids = [
        ...model.variables,
        ...model.shapes,
        ...model.shapes.flatMap((s: any) => s.transforms ?? []),
        ...model.tools,
        ...model.operations,
      ].map((item: any) => item.id);
      expect(new Set(ids).size).withContext(sample.file).toBe(ids.length);
    }
  });

  it('each only refer to tools, shapes and operations they have', async () => {
    for (const sample of samples) {
      const model: any = await loadSample(sample);
      const has = (list: any[], id: string) =>
        list.some((item) => item.id === id);
      for (const op of model.operations) {
        const where = `${sample.file} ${op.id}`;
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
