import { ModelType } from './model-editor/model';

export async function getModelMetadata(model: ModelType) {
  const json = JSON.stringify(model);
  const byteArray = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');

  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  const arrayBuffer = await new Response(cs.readable).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
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
