/**
 * A mesh's triangles from an STL file (binary or ASCII): nine numbers each,
 * the three corners' x, y, z. Throws when the file holds no triangles.
 */
export function parseStl(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  // Binary: an 80-byte header, the triangle count, then 50 bytes each. Some
  // binary files start with "solid" too, so the size decides.
  if (bytes.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === bytes.byteLength) {
      const triangles = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        // Past the normal (3 floats).
        const at = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) {
          triangles[t * 9 + k] = view.getFloat32(at + k * 4, true);
        }
      }
      if (count) return triangles;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const numbers: number[] = [];
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = vertex.exec(text); m; m = vertex.exec(text)) {
    numbers.push(+m[1], +m[2], +m[3]);
  }
  const usable = numbers.length - (numbers.length % 9);
  if (!usable || numbers.slice(0, usable).some((n) => !Number.isFinite(n))) {
    throw new Error('No triangles found: not an STL file?');
  }
  return Float32Array.from(numbers.slice(0, usable));
}

/** The mesh's extent along each axis. */
export type MeshBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export function meshBounds(triangles: Float32Array): MeshBounds {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (let i = 0; i < triangles.length; i += 3) {
    const x = triangles[i];
    const y = triangles[i + 1];
    const z = triangles[i + 2];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

/**
 * The mesh seen from above (+Z) on a grid `width` × `height` over its X / Y
 * extent, rows from the top (+Y) like an image: at each cell centre the
 * highest the mesh is there, 0 at its lowest to 1 at its highest. NaN where
 * the mesh isn't (around it, and through holes).
 */
export function meshHeights(
  triangles: Float32Array,
  width: number,
  height: number,
): { width: number; height: number; data: Float32Array } {
  const data = new Float32Array(width * height).fill(NaN);
  const b = meshBounds(triangles);
  const sizeX = b.maxX - b.minX;
  const sizeY = b.maxY - b.minY;
  if (!(sizeX > 0) || !(sizeY > 0)) {
    return { width, height, data };
  }
  const rise = b.maxZ - b.minZ;
  // Cell coordinates: u across from the left, v down from the top.
  const toU = (x: number) => ((x - b.minX) / sizeX) * width;
  const toV = (y: number) => ((b.maxY - y) / sizeY) * height;
  const level = (z: number) => (rise > 0 ? (z - b.minZ) / rise : 1);

  for (let t = 0; t < triangles.length; t += 9) {
    const u0 = toU(triangles[t]);
    const v0 = toV(triangles[t + 1]);
    const z0 = level(triangles[t + 2]);
    const u1 = toU(triangles[t + 3]);
    const v1 = toV(triangles[t + 4]);
    const z1 = level(triangles[t + 5]);
    const u2 = toU(triangles[t + 6]);
    const v2 = toV(triangles[t + 7]);
    const z2 = level(triangles[t + 8]);
    const area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    // Seen edge on: its edges show on the triangles beside it.
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(u0, u1, u2) - 0.5));
    const i1 = Math.min(width - 1, Math.floor(Math.max(u0, u1, u2) - 0.5));
    const j0 = Math.max(0, Math.ceil(Math.min(v0, v1, v2) - 0.5));
    const j1 = Math.min(height - 1, Math.floor(Math.max(v0, v1, v2) - 0.5));
    for (let j = j0; j <= j1; j++) {
      const v = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const u = i + 0.5;
        // Barycentric weights; a little slack, so cells on an edge two
        // triangles share count.
        const w0 = ((u1 - u) * (v2 - v) - (u2 - u) * (v1 - v)) / area;
        const w1 = ((u2 - u) * (v0 - v) - (u0 - u) * (v2 - v)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const k = j * width + i;
        if (!(data[k] >= z)) data[k] = z;
      }
    }
  }
  return { width, height, data };
}
