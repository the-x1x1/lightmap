/**
 * Browser side of the PDF export: a saved thumbnail (a PNG data URL from the renderer) becomes
 * JPEG bytes through a canvas, so the PDF can carry it as a DCT image. Null when the browser
 * cannot decode or encode it (the PDF then shows the text alone).
 */
import { jpegSize, type PdfImage } from './pdf';

export async function jpegFromDataUrl(dataUrl: string, quality = 0.85): Promise<PdfImage | null> {
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
