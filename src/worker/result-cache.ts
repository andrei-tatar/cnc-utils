/**
 * Worker results kept in IndexedDB across reloads, keyed by a hash of the
 * job (its name and arguments) and of the worker build: reopening the app
 * shows the last project without routing it all again, and code changes
 * never hand back results computed by an older version.
 */

const DB_NAME = 'cnc-utils-results';
const STORE = 'results';
const META = 'meta';
/** Results under this many ms are cheaper to recompute than to store. */
export const MIN_CACHED_MS = 40;
/** Roughly how much to keep (sizes are estimates of the packed results). */
const MAX_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 2000;
/** Check the totals every this many stores. */
const PRUNE_EVERY = 25;

type Meta = { key: string; used: number; bytes: number };

let db: Promise<IDBDatabase | null> | null = null;
let storesSincePrune = 0;

/** The cache's database, or null where IndexedDB can't be used. */
export function openCache(): Promise<IDBDatabase | null> {
  if (!db) {
    db = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      // Some browsers never answer an open: carry on without caching.
      const timer = setTimeout(() => resolve(null), 3000);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore(STORE);
        database
          .createObjectStore(META, { keyPath: 'key' })
          .createIndex('used', 'used');
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          db = null;
        };
        resolve(database);
      };
      // Private windows and blocked storage: just don't cache.
      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
  }
  return db;
}

/** The stored result for `key`, or undefined. */
export async function cachedResult(
  database: IDBDatabase,
  key: string,
): Promise<unknown> {
  try {
    const value = await asPromise(
      database.transaction(STORE).objectStore(STORE).get(key),
    );
    if (value !== undefined) {
      // Mark it as recently used (without waiting).
      const meta = database.transaction(META, 'readwrite').objectStore(META);
      const request = meta.get(key);
      request.onsuccess = () => {
        if (request.result) {
          meta.put({ ...request.result, used: Date.now() } satisfies Meta);
        }
      };
    }
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Keep `value` under `key`. It is copied right away, so its buffers can be
 * transferred elsewhere as soon as this returns.
 */
export function storeResult(
  database: IDBDatabase,
  key: string,
  value: unknown,
) {
  try {
    const tx = database.transaction([STORE, META], 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.objectStore(META).put({
      key,
      used: Date.now(),
      bytes: estimateBytes(value),
    } satisfies Meta);
    done(tx)
      .then(() => {
        if (++storesSincePrune >= PRUNE_EVERY) {
          storesSincePrune = 0;
          return prune(database);
        }
        return undefined;
      })
      .catch(() => {});
  } catch {
    // Quota or a closed database: the result simply isn't kept.
  }
}

/** Drop the least recently used results beyond the size and count limits. */
async function prune(database: IDBDatabase) {
  const all = (await asPromise(
    database.transaction(META).objectStore(META).index('used').getAll(),
  )) as Meta[];
  let bytes = all.reduce((sum, m) => sum + m.bytes, 0);
  let count = all.length;
  const stale: string[] = [];
  for (const meta of all) {
    if (bytes <= MAX_BYTES && count <= MAX_ENTRIES) break;
    stale.push(meta.key);
    bytes -= meta.bytes;
    count--;
  }
  if (!stale.length) return;
  const tx = database.transaction([STORE, META], 'readwrite');
  for (const key of stale) {
    tx.objectStore(STORE).delete(key);
    tx.objectStore(META).delete(key);
  }
  await done(tx);
}

function estimateBytes(value: unknown): number {
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return value.length * 2;
  if (Array.isArray(value)) {
    return value.reduce((sum: number, v) => sum + estimateBytes(v), 16);
  }
  if (typeof value === 'object' && value !== null) {
    let sum = 16;
    for (const v of Object.values(value)) sum += estimateBytes(v) + 8;
    return sum;
  }
  return 8;
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A 128-bit hash of `value` (as `pack` leaves it). Objects hash by sorted
 * keys, so the same settings hash the same whatever order they were set
 * in; typed arrays hash by their bytes.
 */
export function hashValue(value: unknown, seed: string): string {
  const h = new Hasher();
  h.string(seed);
  h.value(value);
  return h.digest();
}

const C1 = [0xcc9e2d51, 0x239b961b, 0xab0e9789, 0x38b34ae5];
const C2 = [0x1b873593, 0x85ebca6b, 0xc2b2ae35, 0xa1e38b93];
const R1 = [15, 16, 17, 18];

/** Four differently seeded 32-bit lanes (MurmurHash3-style mixing). */
class Hasher {
  private lanes = new Uint32Array([
    0x9747b28c, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f,
  ]);
  private scratch = new DataView(new ArrayBuffer(8));

  word(w: number) {
    const lanes = this.lanes;
    for (let i = 0; i < 4; i++) {
      let k = Math.imul(w, C1[i]);
      k = (k << R1[i]) | (k >>> (32 - R1[i]));
      k = Math.imul(k, C2[i]);
      // Each lane also takes in its neighbour, so the four make one
      // 128-bit state rather than four copies of the same 32-bit hash.
      let h = lanes[i] ^ k ^ (lanes[(i + 3) & 3] >>> 7);
      h = (h << 13) | (h >>> 19);
      lanes[i] = Math.imul(h, 5) + 0xe6546b64;
    }
  }

  tag(t: number) {
    this.word(0xfeed0000 | t);
  }

  number(n: number) {
    this.scratch.setFloat64(0, n);
    this.word(this.scratch.getUint32(0));
    this.word(this.scratch.getUint32(4));
  }

  string(s: string) {
    this.tag(1);
    this.word(s.length);
    for (let i = 0; i < s.length; i += 2) {
      this.word(s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16));
    }
  }

  value(v: unknown) {
    if (v === null) return this.tag(2);
    switch (typeof v) {
      case 'undefined':
        return this.tag(3);
      case 'boolean':
        return this.tag(v ? 4 : 5);
      case 'number':
        this.tag(6);
        return this.number(v);
      case 'string':
        return this.string(v);
    }
    if (ArrayBuffer.isView(v)) {
      this.tag(7);
      this.string(v.constructor.name);
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      this.word(bytes.length);
      const whole = bytes.length >> 2;
      // Aligned: read 32-bit words directly.
      if (v.byteOffset % 4 === 0) {
        const words = new Uint32Array(v.buffer, v.byteOffset, whole);
        for (let i = 0; i < whole; i++) this.word(words[i]);
      } else {
        for (let i = 0; i < whole * 4; i += 4) {
          this.word(
            bytes[i] |
              (bytes[i + 1] << 8) |
              (bytes[i + 2] << 16) |
              (bytes[i + 3] << 24),
          );
        }
      }
      for (let i = whole * 4; i < bytes.length; i++) this.word(bytes[i]);
      return;
    }
    if (Array.isArray(v)) {
      this.tag(8);
      this.word(v.length);
      v.forEach((item) => this.value(item));
      return;
    }
    if (typeof v === 'object') {
      this.tag(9);
      const record = v as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      this.word(keys.length);
      for (const key of keys) {
        this.string(key);
        this.value(record[key]);
      }
      return;
    }
    // Functions and symbols don't cross to the worker.
    this.tag(10);
  }

  digest(): string {
    // Finalize each lane (fmix32), mixing in the others.
    const lanes = this.lanes;
    let out = '';
    for (let i = 0; i < 4; i++) {
      let h = lanes[i] ^ lanes[(i + 1) % 4];
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      out += (h >>> 0).toString(16).padStart(8, '0');
    }
    return out;
  }
}
