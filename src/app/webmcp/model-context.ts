/**
 * The page's side of WebMCP (https://webmachinelearning.github.io/webmcp/):
 * a page registers tools with `document.modelContext`, which an agent in
 * the browser can then call. Only in browsers that have it (Chrome with
 * chrome://flags/#enable-webmcp-testing, or a polyfill such as MCP-B's
 * `@mcp-b/global`).
 */

/** What a tool says about itself, to the agent and the browser. */
export type ToolAnnotations = {
  /** It only reads: calling it changes nothing. */
  readOnlyHint?: boolean;
  /** It does something hard to take back: the browser may ask first. */
  consequentialHint?: boolean;
  /** What it returns may come from elsewhere (an opened file, a link). */
  untrustedContentHint?: boolean;
};

export type ModelContextTool = {
  name: string;
  title?: string;
  description: string;
  /** JSON Schema of the input object. */
  inputSchema?: object;
  /** The result is sent to the agent as JSON. */
  execute(
    input: any,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> | unknown;
  annotations?: ToolAnnotations;
};

/**
 * `navigator.modelContext` as the spec has it (`registerTool` with an
 * abort signal that unregisters), and as earlier versions had it
 * (`unregisterTool(name)`, or `registerTool` returning `{ unregister }`).
 */
type ModelContext = {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ): unknown;
  unregisterTool?(name: string): void;
};

/**
 * The browser's model context; null when it has none. Chrome has it on
 * `document` from 150, on `navigator` before (as polyfills do).
 */
export function modelContext(): ModelContext | null {
  type Holder = { modelContext?: ModelContext };
  const context =
    (document as Holder).modelContext ?? (navigator as Holder).modelContext;
  return typeof context?.registerTool === 'function' ? context : null;
}

/** Registers `tools` until `signal` aborts; says how many it could. */
export async function registerTools(
  context: ModelContext,
  tools: readonly ModelContextTool[],
  signal: AbortSignal,
): Promise<number> {
  let registered = 0;
  for (const tool of tools) {
    try {
      const registration = await context.registerTool(tool, { signal });
      signal.addEventListener('abort', () =>
        unregister(context, tool, registration),
      );
      registered++;
    } catch (error) {
      console.error(`[webmcp] couldn’t register ${tool.name}`, error);
    }
  }
  return registered;
}

/** For versions that don't unregister on the signal: ignored when gone. */
function unregister(
  context: ModelContext,
  tool: ModelContextTool,
  registration: unknown,
) {
  try {
    const handle = registration as { unregister?: () => void } | undefined;
    if (typeof handle?.unregister === 'function') {
      handle.unregister();
    } else {
      context.unregisterTool?.(tool.name);
    }
  } catch {
    // Already unregistered by the signal.
  }
}
