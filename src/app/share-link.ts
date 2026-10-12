import { ModelType } from './model-editor/model';
import { getModelMetadata, loadModelFromMetadata } from './store';

/** Where in a link's fragment the project is: `#project=…`. */
const PREFIX = 'project=';

/**
 * Links longer than this (characters) may be cut short by the apps they're
 * sent through (chat, email): worth saying so.
 */
export const LONG_LINK = 8_000;

/** Browsers stop taking links somewhere past this (characters). */
export const TOO_LONG_LINK = 2_000_000;

/**
 * A link to the app at `base` (its address, without a fragment) that opens
 * `model`: the project gzipped, base64url, in the fragment — which browsers
 * never send to a server, so it stays between whoever shares and opens it.
 */
export async function shareLink(
  model: ModelType,
  base: string,
): Promise<string> {
  const data = (await getModelMetadata(model))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${base}#${PREFIX}${data}`;
}

/** The project data in a link's fragment (`location.hash`), if it has one. */
export function sharedProjectData(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return fragment.startsWith(PREFIX) && fragment.length > PREFIX.length
    ? fragment.slice(PREFIX.length)
    : null;
}

/** The project a link's data holds. Throws when it holds none. */
export async function sharedProject(data: string): Promise<ModelType> {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let model: any;
  try {
    model = await loadModelFromMetadata(padded);
  } catch {
    throw new Error('the link is cut short or damaged');
  }
  if (
    !model ||
    typeof model !== 'object' ||
    !Array.isArray(model.shapes) ||
    !Array.isArray(model.operations)
  ) {
    throw new Error('the link holds no project');
  }
  return model;
}
