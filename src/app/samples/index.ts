import { loadModelFromGcode } from '../store';

/**
 * Example projects offered in the toolbar's Samples menu: the .nc files in
 * the repository's `samples/` folder (served as assets under `samples/`),
 * with the project embedded like any downloaded G-code. They're listed in
 * `samples/index.json`, written by `scripts/samples-index.mjs` before start,
 * build and test.
 */
export type Sample = {
  /** The file's name in `samples/`. */
  file: string;
  name: string;
  description: string;
};

/** The samples there are; none when the list can't be had. */
export async function listSamples(): Promise<Sample[]> {
  try {
    const response = await fetch('samples/index.json');
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

/** The project in a sample's file, as stored (not migrated). */
export async function loadSample(sample: Sample): Promise<unknown> {
  const response = await fetch(`samples/${sample.file}`);
  if (!response.ok) {
    throw new Error(
      `Could not fetch sample ${sample.file}: ${response.status}`,
    );
  }
  const model = await loadModelFromGcode(await response.text());
  if (!model) {
    throw new Error(`Sample ${sample.file} has no embedded project`);
  }
  return model;
}
