import { MeshTransform, transformMesh } from '../../cam/model-mesh';
import { parseModelFile } from '../../cam/threemf';

/**
 * A 3D model shape's mesh: its file's (STL or 3MF) triangles (nine numbers each,
 * the three corners' x, y, z) with the shape's transforms applied, in
 * design coordinates (Z 0 the top of the stock). Null without a file.
 */
export async function modelShape(
  file: string,
  transforms: MeshTransform[],
): Promise<Float32Array | null> {
  if (!file) {
    return null;
  }
  const triangles = await parseModelFile(
    await (await fetch(file)).arrayBuffer(),
  );
  return transformMesh(triangles, transforms);
}
