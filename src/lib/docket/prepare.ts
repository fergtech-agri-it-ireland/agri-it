/**
 * Clean up a yard photo before reading it. Runs on the phone, no network.
 *
 * - Turns the photo the right way up (camera orientation) and scales it to a size
 *   the reader likes (about 2,000 px on the long side).
 * - Evens out the light: shed lighting, a thumb's shadow or a crease makes one part
 *   of the page darker. We estimate the background brightness from a tiny copy of
 *   the image and divide it out, so dark corners read like the bright middle.
 * - Stretches the contrast so faint print stands out.
 * Straightening a crooked page is done by the reader itself (automatic rotation).
 */
const LONG_SIDE = 2000;

async function bitmapOf(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export async function preparePhoto(file: Blob): Promise<HTMLCanvasElement> {
  const src = await bitmapOf(file);
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1.6, LONG_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);

  // Background light map: shrink to ~1/24 (text disappears), then scale back up smoothly
  const bw = Math.max(1, Math.round(w / 24));
  const bh = Math.max(1, Math.round(h / 24));
  const small = document.createElement('canvas');
  small.width = bw;
  small.height = bh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, bw, bh);
  // Text is dark: take a local maximum so the map follows the paper, not the ink
  const sm = sctx.getImageData(0, 0, bw, bh);
  const lum = new Float32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) lum[i] = 0.299 * sm.data[i * 4] + 0.587 * sm.data[i * 4 + 1] + 0.114 * sm.data[i * 4 + 2];
  const paper = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = Math.min(bh - 1, Math.max(0, y + dy));
        const xx = Math.min(bw - 1, Math.max(0, x + dx));
        m = Math.max(m, lum[yy * bw + xx]);
      }
      paper[y * bw + x] = Math.max(m, 24);
    }
  }

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    // Bilinear lookup into the paper map
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / 24 - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / 24 - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const bg = (paper[y0 * bw + x0] * (1 - tx) + paper[y0 * bw + x1] * tx) * (1 - ty) + (paper[y1 * bw + x0] * (1 - tx) + paper[y1 * bw + x1] * tx) * ty;
      const i = (y * w + x) * 4;
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      out[y * w + x] = Math.min(255, (g / bg) * 255);
    }
  }

  // Contrast stretch between the 1st and 99th percentile
  const hist = new Uint32Array(256);
  for (let i = 0; i < out.length; i++) hist[out[i] | 0]++;
  const lo = percentile(hist, out.length * 0.01);
  const hi = Math.max(lo + 1, percentile(hist, out.length * 0.99));
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(0, Math.min(255, ((out[i] - lo) / (hi - lo)) * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if ('close' in src) src.close();
  return canvas;
}

function percentile(hist: Uint32Array, target: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    sum += hist[v];
    if (sum >= target) return v;
  }
  return 255;
}

/** Small JPEG of the photo for the thumbnail and the stored evidence copy. */
export async function shrinkForStorage(file: Blob, longSide = 2000): Promise<Blob> {
  const src = await bitmapOf(file);
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, longSide / Math.max(sw, sh));
  if (scale === 1 && file.size < 1_500_000) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.82));
}
