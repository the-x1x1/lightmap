/**
 * A small PDF writer for the shot list (no dependency): Courier text in A4 pages with JPEG
 * pictures (the saved viewpoints' thumbnails) — PDF 1.4, one font, WinAnsi text, DCT images,
 * a classic cross-reference table. Everything a reader needs and nothing else; the output is
 * built as bytes so the xref offsets are exact. Pure and unit-tested; the browser side only
 * turns thumbnails into JPEG bytes (`jpegFromDataUrl` in the component).
 */

export const PAGE_W = 595.28; // A4 portrait, points
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const FONT_PT = 9;
export const LINE_PT = 12;
/** Courier is 0.6 em wide, so this many characters fit a line inside the margins. */
export const LINE_CHARS = Math.floor((PAGE_W - 2 * MARGIN) / (FONT_PT * 0.6));

export interface PdfImage {
  /** Baseline JPEG bytes (DCTDecode); progressive JPEG is fine for every modern reader too. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** One block of the document: lines of text, optionally followed by a picture. */
export interface PdfBlock {
  lines: readonly string[];
  image?: PdfImage | null;
  /** Points to draw the picture wide (its height follows); default 240. */
  imageWidthPt?: number;
  /** The first line is a heading: bold is not available in one font, so it is set at 11 pt. */
  heading?: boolean;
}

/** Characters outside WinAnsi that the planner's text uses, mapped to what Courier can show. */
const WINANSI_SUBSTITUTES: Record<string, string> = {
  '−': '-', // true minus
  '≥': '>=',
  '≤': '<=',
  '≈': '~',
  '↑': '^',
  '↓': 'v',
  '→': '->',
  '←': '<-',
  '…': '...',
  '✓': 'x',
  '✔': 'x',
  '✖': 'x',
  '★': '*',
  '✦': '*',
  '☁': '(cloud)',
  '▲': '^',
  '▽': 'v',
  '☐': '[ ]',
  '☑': '[x]',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

/** WinAnsiEncoding code points for the Unicode characters in 0x80–0x9F that it defines. */
const WINANSI_HIGH: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/**
 * Text → WinAnsi bytes (as a latin1 string), substituting what the planner writes that the
 * encoding lacks and '?' for anything else, with the PDF string escapes applied.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const sub = WINANSI_SUBSTITUTES[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    const high = WINANSI_HIGH[ch];
    const code = high ?? ch.codePointAt(0)!;
    if (high === undefined && (code > 0xff || (code >= 0x80 && code < 0xa0))) {
      out += '?';
      continue;
    }
    out += String.fromCharCode(code);
  }
  return out;
}

/** A document-information text string: UTF-16BE with a byte-order mark, as a hex string. */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++)
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function pdfString(latin1: string): string {
  return `(${latin1.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/** Wrap a line at `width` characters on spaces, keeping its leading indent on the continuations. */
export function wrapLine(line: string, width = LINE_CHARS): string[] {
  if (line.length <= width) return [line];
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const words = line.trim().split(/\s+/);
  const out: string[] = [];
  let current = indent;
  for (const w of words) {
    const candidate = current.trim().length === 0 ? indent + w : `${current} ${w}`;
    if (candidate.length > width && current.trim().length > 0) {
      out.push(current);
      current = `${indent}  ${w}`;
    } else current = candidate;
  }
  if (current.trim().length > 0) out.push(current);
  return out;
}

interface PageDraft {
  ops: string[];
  images: Array<{ name: string; index: number }>;
}

function num(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Lay the blocks out over pages and write the PDF. Blocks never split a picture from the lines
 * above it; a block longer than a page flows over as text.
 */
export function buildPdf(
  blocks: readonly PdfBlock[],
  meta: { title: string; author?: string; createdAt?: Date },
): Uint8Array<ArrayBuffer> {
  const images: PdfImage[] = [];
  const pages: PageDraft[] = [];
  let page: PageDraft = { ops: [], images: [] };
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    pages.push(page);
    page = { ops: [], images: [] };
    y = PAGE_H - MARGIN;
  };
  const textLine = (text: string, size: number) => {
    if (y - LINE_PT < MARGIN) newPage();
    page.ops.push(
      `BT /F1 ${size} Tf ${num(MARGIN)} ${num(y - size)} Td ${pdfString(toWinAnsi(text))} Tj ET`,
    );
    y -= size === FONT_PT ? LINE_PT : LINE_PT + 3;
  };
  for (const block of blocks) {
    const lines = block.lines.flatMap((l) => wrapLine(l));
    const imgW = block.imageWidthPt ?? 240;
    const imgH = block.image ? (imgW * block.image.height) / block.image.width : 0;
    const need = lines.length * LINE_PT + (block.image ? imgH + LINE_PT : 0) + LINE_PT;
    // Keep a short block (text and picture) together on one page.
    if (need < PAGE_H - 2 * MARGIN && y - need < MARGIN) newPage();
    lines.forEach((l, i) => textLine(l, block.heading && i === 0 ? 11 : FONT_PT));
    if (block.image) {
      if (y - imgH < MARGIN) newPage();
      const index = images.push(block.image) - 1;
      const name = `Im${index}`;
      page.images.push({ name, index });
      page.ops.push(
        `q ${num(imgW)} 0 0 ${num(imgH)} ${num(MARGIN)} ${num(y - imgH)} cm /${name} Do Q`,
      );
      y -= imgH + LINE_PT;
    }
    y -= LINE_PT;
  }
  pages.push(page);

  // Objects: 1 catalog, 2 pages, 3 font, 4 info, then per page (page, contents), then images.
  const objects: Array<string | Uint8Array> = [];
  const add = (body: string | Uint8Array) => objects.push(body); // the new length is the 1-based id
  const catalogId = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesId = add(''); // filled once the page ids are known
  const fontId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  );
  const d = meta.createdAt ?? new Date();
  const stamp = `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  const infoId = add(
    `<< /Title ${pdfTextString(meta.title)} /Producer (LightMap) ${meta.author ? `/Author ${pdfTextString(meta.author)} ` : ''}/CreationDate (${stamp}) >>`,
  );
  const imageIds = images.map((img) => {
    const header = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`;
    const bytes = new Uint8Array(header.length + img.jpeg.length + '\nendstream'.length);
    bytes.set(latin1Bytes(header), 0);
    bytes.set(img.jpeg, header.length);
    bytes.set(latin1Bytes('\nendstream'), header.length + img.jpeg.length);
    return add(bytes);
  });
  const pageIds = pages.map((p) => {
    const content = p.ops.join('\n');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xobjects = p.images.map((i) => `/${i.name} ${imageIds[i.index]} 0 R`).join(' ');
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 ${fontId} 0 R >> ${xobjects ? `/XObject << ${xobjects} >>` : ''} >> /Contents ${contentId} 0 R >>`,
    );
  });
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Serialise with exact offsets.
  const parts: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  push(latin1Bytes('%PDF-1.4\n%âãÏÓ\n'));
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    push(latin1Bytes(`${i + 1} 0 obj\n`));
    push(typeof body === 'string' ? latin1Bytes(body) : body);
    push(latin1Bytes('\nendobj\n'));
  });
  const xref = offset;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(latin1Bytes(table));
  const out = new Uint8Array(new ArrayBuffer(offset));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function latin1Bytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/** Width and height from a JPEG's start-of-frame marker; null when it is not a JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    // SOF0–SOF15 except the DHT/JPG/DAC markers that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    i += 2 + len;
  }
  return null;
}
