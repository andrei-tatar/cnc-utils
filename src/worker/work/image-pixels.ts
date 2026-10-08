/** An image's pixels, RGBA row by row from the top (as `ImageData`). */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * The pixels of the image at `image` (a data URL), drawn at the size `size`
 * picks from its own (whole pixels, at least 1 × 1), scaled with the
 * `smoothing` quality given (the canvas's default otherwise). Transparent
 * areas come out white, like paper.
 */
export async function imagePixels(
  image: string,
  size: (width: number, height: number) => { width: number; height: number },
  smoothing?: ImageSmoothingQuality,
): Promise<Pixels> {
  const blob = await (await fetch(image)).blob();
  const bitmap = await createImageBitmap(blob);
  const wanted = size(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(wanted.width));
  const h = Math.max(1, Math.round(wanted.height));
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  if (smoothing) {
    context.imageSmoothingQuality = smoothing;
  }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, w, h);
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = context.getImageData(0, 0, w, h);
  return { width: w, height: h, data };
}

/** Brightness of the pixel at `i`, 0–255 (Rec. 601 luma). */
export function brightnessAt(data: Uint8ClampedArray, i: number): number {
  return (
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  );
}
