import { parseStl } from './stl';

/**
 * A mesh's triangles (nine numbers each, like `parseStl`'s) from a 3D model
 * file: a 3MF package (a zip, told by how it starts) or an STL file.
 */
export async function parseModelFile(
  bytes: ArrayBuffer,
): Promise<Float32Array> {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  return head[0] === 0x50 && head[1] === 0x4b
    ? parse3mf(bytes)
    : parseStl(bytes);
}

/** Millimetres per unit a 3MF model can be in. */
const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/**
 * A 3×4 transform as 3MF writes it (rows, applied to row vectors: the last
 * row moves).
 */
type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** `a`, then `b`. */
function compose(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(12);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col] +
        (row === 3 ? b[9 + col] : 0);
    }
  }
  return out;
}

type ModelObject = {
  /** Its own mesh's corners (x, y, z each) and triangles (three each). */
  vertices: number[];
  triangles: number[];
  /** Other objects it's made of. */
  components: { path: string; id: string; transform: Matrix }[];
};

type ModelPart = {
  scale: number;
  objects: Map<string, ModelObject>;
  items: { path: string; id: string; transform: Matrix }[];
};

/**
 * The triangles of what a 3MF package builds, in mm: every build item's
 * object with the objects it's made of, each placed by its transform.
 * Objects kept in other model files of the package (the production
 * extension) are followed. Throws when it holds no triangles.
 */
export async function parse3mf(bytes: ArrayBuffer): Promise<Float32Array> {
  const files = zipEntries(bytes);
  const names = [...files.keys()];
  const find = (path: string) => {
    const wanted = path.replace(/^\/+/, '').toLowerCase();
    return names.find((name) => name.toLowerCase() === wanted);
  };
  // The package says which part is the model; else the usual one, or any.
  const rels = find('_rels/.rels');
  const target =
    rels &&
    /<Relationship\b[^>]*3dmodel[^>]*>/i
      .exec(await files.get(rels)!())?.[0]
      .match(/\bTarget\s*=\s*"([^"]*)"/i)?.[1];
  const root =
    (target && find(target)) ??
    find('3D/3dmodel.model') ??
    names.find((name) => /\.model$/i.test(name));
  if (!root) {
    throw new Error('No 3D model found: not a 3MF file?');
  }

  const parts = new Map<string, Promise<ModelPart>>();
  const part = (path: string) => {
    const name = find(path) ?? root;
    let read = parts.get(name);
    if (!read) {
      parts.set(name, (read = files.get(name)!().then(readPart)));
    }
    return read;
  };

  const out: number[] = [];
  const add = async (
    path: string,
    id: string,
    transform: Matrix,
    depth: number,
  ) => {
    const { objects, scale } = await part(path);
    const object = objects.get(id);
    if (!object || depth > 16) return;
    const v = object.vertices;
    const m = transform;
    for (const corner of object.triangles) {
      const x = v[corner * 3] * scale;
      const y = v[corner * 3 + 1] * scale;
      const z = v[corner * 3 + 2] * scale;
      out.push(
        x * m[0] + y * m[3] + z * m[6] + m[9],
        x * m[1] + y * m[4] + z * m[7] + m[10],
        x * m[2] + y * m[5] + z * m[8] + m[11],
      );
    }
    for (const c of object.components) {
      // A component's transform is in its file's units too.
      await add(
        c.path || path,
        c.id,
        compose(scaled(c.transform, scale), transform),
        depth + 1,
      );
    }
  };
  const main = await part(root);
  for (const item of main.items) {
    await add(
      item.path || root,
      item.id,
      scaled(item.transform, main.scale),
      0,
    );
  }
  // Nothing said to be built: every object with a mesh, as it is.
  if (!main.items.length) {
    for (const id of main.objects.keys()) {
      await add(root, id, IDENTITY, 0);
    }
  }
  if (!out.length || out.some((n) => !Number.isFinite(n))) {
    throw new Error('No triangles found in the 3MF file');
  }
  return Float32Array.from(out);
}

/** A transform with what it moves by in mm. */
function scaled(m: Matrix, scale: number): Matrix {
  return [...m.slice(0, 9), m[9] * scale, m[10] * scale, m[11] * scale];
}

const attribute = (tag: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];

function matrixOf(tag: string): Matrix {
  const numbers = (attribute(tag, 'transform') ?? '')
    .trim()
    .split(/\s+/)
    .map(Number);
  return numbers.length === 12 && numbers.every(Number.isFinite)
    ? numbers
    : IDENTITY;
}

/** One model file of the package: its objects and what it builds. */
function readPart(xml: string): ModelPart {
  const model = /<model\b[^>]*>/i.exec(xml)?.[0] ?? '';
  const scale =
    UNITS[(attribute(model, 'unit') ?? 'millimeter').toLowerCase()] ?? 1;
  const objects = new Map<string, ModelObject>();
  const object = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  for (let m = object.exec(xml); m; m = object.exec(xml)) {
    const id = attribute(m[1], 'id');
    if (id === undefined) continue;
    const body = m[2];
    const vertices: number[] = [];
    const triangles: number[] = [];
    const vertex = /<vertex\b([^>]*)>/gi;
    for (let v = vertex.exec(body); v; v = vertex.exec(body)) {
      vertices.push(
        Number(attribute(v[1], 'x')),
        Number(attribute(v[1], 'y')),
        Number(attribute(v[1], 'z')),
      );
    }
    const triangle = /<triangle\b([^>]*)>/gi;
    const count = vertices.length / 3;
    for (let t = triangle.exec(body); t; t = triangle.exec(body)) {
      const corners = ['v1', 'v2', 'v3'].map((k) => Number(attribute(t[1], k)));
      if (corners.every((c) => Number.isInteger(c) && c >= 0 && c < count)) {
        triangles.push(...corners);
      }
    }
    const components: ModelObject['components'] = [];
    const component = /<component\b([^>]*)>/gi;
    for (let c = component.exec(body); c; c = component.exec(body)) {
      const of = attribute(c[1], 'objectid');
      if (of !== undefined) {
        components.push({
          path: attribute(c[1], '[\\w]+:path') ?? '',
          id: of,
          transform: matrixOf(c[1]),
        });
      }
    }
    objects.set(id, { vertices, triangles, components });
  }
  const items: ModelPart['items'] = [];
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/i.exec(xml)?.[1] ?? '';
  const item = /<item\b([^>]*)>/gi;
  for (let i = item.exec(build); i; i = item.exec(build)) {
    const id = attribute(i[1], 'objectid');
    if (id !== undefined) {
      items.push({
        path: attribute(i[1], '[\\w]+:path') ?? '',
        id,
        transform: matrixOf(i[1]),
      });
    }
  }
  return { scale, objects, items };
}

/**
 * A zip archive's files by name, each read (as text) when asked for:
 * stored or deflated, without zip64.
 */
function zipEntries(bytes: ArrayBuffer): Map<string, () => Promise<string>> {
  const view = new DataView(bytes);
  const size = bytes.byteLength;
  // The end of the central directory: at the end, before a comment if any.
  let end = -1;
  for (let at = size - 22; at >= Math.max(0, size - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) {
    throw new Error('Not a 3MF file (no zip directory)');
  }
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<string>>();
  for (let i = 0; i < count && at + 46 <= size; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(bytes, at + 46, nameLength));
    entries.set(name, async () => {
      if (packed === 0xffffffff || local === 0xffffffff) {
        throw new Error('This 3MF file is too big to read (zip64)');
      }
      // Past the local header, whose name and extra field have their own
      // lengths.
      const start =
        local +
        30 +
        view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      const data = new Uint8Array(bytes, start, packed);
      if (method === 0) {
        return decoder.decode(data);
      }
      if (method !== 8) {
        throw new Error(
          `This 3MF file is packed in a way that isn’t read (${method})`,
        );
      }
      const stream = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
