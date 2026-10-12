import {
  migrate,
  migrateModel,
  Migration,
  MODEL_VERSION,
  NewerProjectError,
  storedModel,
} from './migrations';
import { emptyModel } from './model';

describe('migrations', () => {
  // Two made-up format changes: version 1 → 2 renames `a` to `b`, 2 → 3
  // doubles `b`.
  const migrations: Migration[] = [
    ({ a, ...model }) => ({ ...model, b: a }),
    (model) => ({ ...model, b: model.b * 2 }),
  ];

  it('stores a project with the current version', () => {
    const stored = storedModel(emptyModel());
    expect(stored.version).toBe(MODEL_VERSION);
    expect(migrateModel(JSON.parse(JSON.stringify(stored)))).toEqual(
      emptyModel(),
    );
  });

  it('reads a project without a version as version 1', () => {
    expect(migrate({ a: 2 }, migrations) as any).toEqual({ b: 4 });
  });

  it('runs only the migrations after the project’s version', () => {
    expect(migrate({ version: 2, b: 3 }, migrations) as any).toEqual({
      b: 6,
    });
    expect(migrate({ version: 3, b: 3 }, migrations) as any).toEqual({
      b: 3,
    });
  });

  it('refuses a project of a newer version', () => {
    expect(() => migrate({ version: 4 }, migrations)).toThrowMatching(
      (error) => error instanceof NewerProjectError && error.version === 4,
    );
  });

  it('refuses what isn’t a project', () => {
    for (const stored of [
      null,
      3,
      'text',
      [],
      { version: 0 },
      { version: 'x' },
    ]) {
      expect(() => migrate(stored, migrations)).toThrow();
    }
  });
});
