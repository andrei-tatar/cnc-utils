import { emptyModel, ModelType } from '../../../src/app/model-editor/model';

/** A project the regression harness runs (see ../README.md). */
export type Fixture = {
  /** Unique, kebab-case: names the baseline files. */
  name: string;
  /** What it covers, one line. */
  covers: string;
  model: ModelType;
};

/** A model from the empty one, with `parts` replacing its lists. */
export function project(parts: Partial<ModelType>): ModelType {
  return { ...emptyModel(), ...parts };
}
