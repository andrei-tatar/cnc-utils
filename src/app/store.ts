import { ModelType } from './model-editor/model';

export async function getModelMetadata(model: ModelType) {
  const json = JSON.stringify(model);
  const byteArray = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');

  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  const arrayBuffer = await new Response(cs.readable).arrayBuffer();
  return toBase64(new Uint8Array(arrayBuffer));
}

/**
 * In chunks: spreading a large array into `String.fromCharCode` overflows
 * the stack (from roughly 100 KB, e.g. a project with a big imported SVG).
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function loadModelFromMetadata(
  metadata: string,
): Promise<ModelType> {
  const binaryString = atob(metadata);

  const length = binaryString.length;
  const bytes = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const cs = new DecompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const arrayBuffer = await new Response(cs.readable).arrayBuffer();
  const decoded = new TextDecoder().decode(arrayBuffer);
  return JSON.parse(decoded);
}
