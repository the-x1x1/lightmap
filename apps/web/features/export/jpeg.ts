/**
 * Browser side of the PDF export: a saved thumbnail (a data URL from the renderer — JPEG as
 * `captureThumbnail` writes it, or PNG from an older save) becomes JPEG bytes the PDF can carry
 * as a DCT image: a JPEG data URL is decoded straight from its base64 (no second generation of
 * loss), anything else goes through a canvas. Null when the browser cannot decode or encode it
 * (the PDF then shows the text alone).
 */
import { jpegSize, type PdfImage } from './pdf';

/** The bytes of a base64 data URL, or null when it is not one. */
export function bytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2] ?? '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function jpegFromDataUrl(dataUrl: string, quality = 0.85): Promise<PdfImage | null> {
  if (dataUrl.startsWith('data:image/jpeg;base64,')) {
    const jpeg = bytesFromDataUrl(dataUrl);
    const size = jpeg ? jpegSize(jpeg) : null;
    // The PDF declares the image RGB: a three-component JPEG goes in as it is; a greyscale or
    // CMYK one takes the canvas path below, which re-encodes it as RGB.
    if (jpeg && size && size.components === 3)
      return { jpeg, width: size.width, height: size.height };
  }
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('thumbnail did not decode'));
    });
    img.src = dataUrl;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // A JPEG has no alpha: paint the page's dark backdrop under any transparent corner first.
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return null;
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const size = jpegSize(jpeg);
    if (!size) return null;
    return { jpeg, ...size };
  } catch {
    return null;
  }
}
