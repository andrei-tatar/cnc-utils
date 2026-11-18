/**
 * Sending a program to cncjs (https://github.com/cncjs/cncjs), a G-code
 * sender running on another machine of the user's network, through its REST
 * API: sign in for a token, find the port it has open, load the program for
 * it (as if uploaded in its own page; running it is done there).
 *
 * The browser must let this page call it: cncjs's API doesn't answer other
 * sites (no CORS headers), so a proxy in front of it adds them, and from an
 * https page Chrome only reaches a plain http address on the local network
 * when the request says that's where it goes (`targetAddressSpace`), once
 * the user allows it.
 */

/** What's kept about the user's cncjs, in this browser. */
export type CncjsSettings = {
  /** Where it answers, as normalised by `cncjsAddress()`; '' when not set. */
  address: string;
  /** The G-code button sends to it, instead of downloading. */
  byDefault: boolean;
};

/** A port cncjs has open, with the kind of controller on it. */
export type CncjsPort = { port: string; controller: string };

/** Something that went wrong, with what may help. */
export class CncjsError extends Error {
  constructor(
    message: string,
    readonly hint = '',
  ) {
    super(message);
  }
}

const SETTINGS_KEY = 'cncjs';
/** How long cncjs gets to answer (ms); a program may be big. */
const TIMEOUT = 10_000;
const LOAD_TIMEOUT = 120_000;

export function loadCncjsSettings(): CncjsSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const address = cncjsAddress(String(stored?.address ?? ''));
    return { address, byDefault: !!address && stored?.byDefault === true };
  } catch {
    return { address: '', byDefault: false };
  }
}

export function saveCncjsSettings(settings: CncjsSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * The address as typed ("cncjs.lan:8000", "http://192.168.1.20:8000/"),
 * made into the start of its URLs (http when it doesn't say, no trailing
 * slash); '' when it isn't an address.
 */
export function cncjsAddress(typed: string): string {
  const text = typed.trim();
  // (A URL would take spaces in a host name, as %20.)
  if (!text || /\s/.test(text)) return '';
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`,
    );
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
      return '';
    }
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** Signs in and lists the ports cncjs has open. */
export async function cncjsPorts(
  address: string,
): Promise<{ token: string; ports: CncjsPort[] }> {
  const signedIn = await request(address, '/api/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '' }),
  });
  if (signedIn.status === 401) {
    throw new CncjsError(
      'cncjs asks for a user name and password.',
      'Signing in as a user isn’t supported: it works with cncjs’s user accounts turned off.',
    );
  }
  const token = (await answer(signedIn))?.token;
  if (typeof token !== 'string' || !token) {
    throw new CncjsError('What answered at that address isn’t cncjs.');
  }
  const controllers = await answer(
    await request(address, '/api/controllers', {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  const ports = (Array.isArray(controllers) ? controllers : [])
    .filter((c) => typeof c?.port === 'string')
    .map((c) => ({
      port: c.port as string,
      controller: String(c.controller?.type ?? ''),
    }));
  return { token, ports };
}

/** Loads a program in cncjs for one of its open ports. */
export async function loadInCncjs(
  address: string,
  token: string,
  port: string,
  name: string,
  gcode: string,
) {
  await answer(
    await request(
      address,
      '/api/gcode',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ port, name, gcode }),
      },
      LOAD_TIMEOUT,
    ),
  );
}

/**
 * Whether requests have to say they go to the local network (an https page
 * calling a plain http address): found out by the first one.
 */
let local: boolean | null = null;

async function request(
  address: string,
  path: string,
  init: RequestInit,
  timeout = TIMEOUT,
): Promise<Response> {
  const attempt = (toLocal: boolean) =>
    fetch(address + path, {
      ...init,
      credentials: 'omit',
      signal: AbortSignal.timeout(timeout),
      ...(toLocal ? { targetAddressSpace: 'local' } : {}),
    } as RequestInit);
  const order = local === null ? [false, true] : [local];
  let failure: unknown;
  for (const toLocal of order) {
    try {
      const response = await attempt(toLocal);
      local = toLocal;
      return response;
    } catch (error) {
      failure = error;
    }
  }
  console.warn('[cncjs] request failed', failure);
  const timedOut = (failure as Error)?.name === 'TimeoutError';
  throw new CncjsError(
    timedOut
      ? `cncjs at ${address} didn’t answer in time.`
      : `cncjs can’t be reached at ${address}.`,
    'Check the address, and that cncjs is running. The browser must also be let through: cncjs has to answer this site (a proxy in front of it adding CORS headers), and Chrome asks to allow access to the local network.',
  );
}

/** A response's content; throws for one that says something went wrong. */
async function answer(response: Response): Promise<any> {
  const content = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CncjsError(
      `cncjs refused (${response.status})` +
        (typeof content?.msg === 'string' ? `: ${content.msg}` : '.'),
    );
  }
  return content;
}
