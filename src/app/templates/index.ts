import { loadModelFromGcode } from '../store';

/**
 * Example projects offered in the toolbar's Templates menu: the .nc files in
 * the repository's `templates/` folder (served as assets under `templates/`),
 * with the project embedded like any downloaded G-code. They're listed in
 * `templates/index.json`, written by `scripts/templates-index.mjs` before start,
 * build and test.
 */
export type Template = {
  /** The file's name in `templates/`. */
  file: string;
  name: string;
  description: string;
};

/** The templates there are; none when the list can't be had. */
export async function listTemplates(): Promise<Template[]> {
  try {
    const response = await fetch('templates/index.json');
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

/** The project in a template's file. */
export async function loadTemplate(template: Template): Promise<unknown> {
  const response = await fetch(`templates/${template.file}`);
  if (!response.ok) {
    throw new Error(
      `Could not fetch template ${template.file}: ${response.status}`,
    );
  }
  const model = await loadModelFromGcode(await response.text());
  if (!model) {
    throw new Error(`Template ${template.file} has no embedded project`);
  }
  return model;
}
