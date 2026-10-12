import { describe, expect, it } from 'vitest';
import {
  LINE_CHARS,
  buildPdf,
  jpegSize,
  pdfTextString,
  toWinAnsi,
  wrapLine,
  type PdfImage,
} from '../../features/export/pdf.ts';
import { buildShotListPdf, shotListPdfBlocks } from '../../features/export/shot-list-pdf.ts';
import type { ProjectDto, ViewpointDto } from '../../lib/api-types.ts';

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
};

/** The smallest baseline JPEG that parses: SOI, a 2×3 SOF0 frame header, EOI. */
const tinyJpeg = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00, // SOF0
    0xff,
    0xd9, // EOI
  ]);

describe('pdf writer', () => {
  it('encodes the planner’s text as WinAnsi with substitutes and escapes', () => {
    expect(toWinAnsi('12 °C · −3 — ok')).toBe('12 °C · -3 \u0097 ok');
    expect(toWinAnsi('≥ 95 % ✦ ☁ ↓ ▲ ▽ (a)\\')).toBe('>= 95 % * (cloud) v ^ v (a)\\');
    expect(toWinAnsi('’quote’ “x” …')).toBe('\u0092quote\u0092 \u0093x\u0094 ...');
    expect(toWinAnsi('漢')).toBe('?');
    expect(pdfTextString('A—b')).toBe('<FEFF004120140062>');
  });

  it('wraps long lines on spaces and keeps the indent', () => {
    const line = `  Weather: ${'cloud '.repeat(40)}end`;
    const wrapped = wrapLine(line, 40);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const w of wrapped) expect(w.length).toBeLessThanOrEqual(40);
    expect(wrapped[0]).toMatch(/^ {2}Weather: cloud/);
    expect(wrapped[1]).toMatch(/^ {4}cloud/);
    expect(wrapLine('short')).toEqual(['short']);
    expect(LINE_CHARS).toBe(92);
  });

  it('reads a JPEG’s size from its frame header', () => {
    expect(jpegSize(tinyJpeg(320, 180))).toEqual({ width: 320, height: 180 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('writes a well-formed PDF: header, one object per part, exact xref offsets, trailer', () => {
    const img: PdfImage = { jpeg: tinyJpeg(320, 180), width: 320, height: 180 };
    const bytes = buildPdf(
      [
        { heading: true, lines: ['Title (with parens)', 'second'] },
        { lines: ['block with a picture'], image: img },
        { lines: Array.from({ length: 80 }, (_, i) => `line ${i}`) },
      ],
      { title: 'Test — list', author: 'LightMap', createdAt: new Date('2026-06-01T12:00:00Z') },
    );
    const s = latin1(bytes);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.endsWith('%%EOF\n')).toBe(true);
    expect(s).toContain('/BaseFont /Courier /Encoding /WinAnsiEncoding');
    expect(s).toContain('/Filter /DCTDecode');
    expect(s).toContain('/Title <FEFF0054006500730074002020140020006C006900730074>');
    expect(s).toContain('/CreationDate (D:20260601120000Z)');
    expect(s).toContain('(Title \\(with parens\\)) Tj');
    // Two pages: the 80 lines overflow the first.
    expect(s).toContain('/Count 2');
    // Every xref offset points at "<n> 0 obj".
    const startxref = Number(s.match(/startxref\n(\d+)\n/)![1]);
    const table = s.slice(startxref);
    const count = Number(table.match(/xref\n0 (\d+)/)![1]);
    const entries = [...table.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(count - 1);
    entries.forEach((off, i) =>
      expect(s.slice(off, off + 20)).toMatch(new RegExp(`^${i + 1} 0 obj\\n`)),
    );
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
  });
});

const project: ProjectDto = {
  id: 'p1',
  name: 'Kailua weekend',
  description: 'Park at the boat ramp.',
  shootDate: '2026-06-15',
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  viewpointCount: 2,
  upcomingViewpointCount: 0,
};

const v1: ViewpointDto = {
  id: 'v1',
  projectId: 'p1',
  label: 'Beach, noon',
  latitude: 21.397,
  longitude: -157.727,
  elevationM: 3,
  timezone: 'Pacific/Honolulu',
  headingDeg: 270,
  pitchDeg: 5,
  fieldOfViewDeg: 60,
  focalLengthEquivalentMm: 24,
  selectedDatetimeUtc: '2026-05-31T22:30:00Z',
  weatherMode: 'SCENARIO',
  weatherScenario: 'overcast',
  previewSourceType: 'ESTIMATED_PREVIEW',
  parentViewpointId: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('shot list PDF', () => {
  it('composes a heading, the notes, a block per viewpoint with its thumbnail, variants indented, and the footer', () => {
    const variant: ViewpointDto = {
      ...v1,
      id: 'v2',
      label: 'Beach, noon, 85 mm',
      parentViewpointId: 'v1',
      focalLengthEquivalentMm: 85,
    };
    const thumbnails = new Map([['v1', { jpeg: tinyJpeg(320, 180), width: 320, height: 180 }]]);
    const blocks = shotListPdfBlocks(project, [variant, v1], {
      appUrl: 'https://lightmap.test',
      generatedAt: new Date('2026-06-01T12:00:00Z'),
      thumbnails,
    });
    expect(blocks[0]?.lines[0]).toBe('Kailua weekend — shot list');
    expect(blocks[0]?.lines[1]).toBe('Shoot date: 2026-06-15');
    expect(blocks[1]?.lines).toEqual(['Notes:', '  Park at the boat ramp.']);
    expect(blocks[2]?.lines[0]).toBe('Beach, noon');
    expect(blocks[2]?.image).toBe(thumbnails.get('v1'));
    expect(blocks[2]?.imageWidthPt).toBe(240);
    expect(blocks[3]?.lines[0]).toBe('    Beach, noon, 85 mm');
    expect(blocks[3]?.image).toBeNull();
    expect(blocks[3]?.heading).toBe(false);
    expect(blocks.at(-1)?.lines[0]).toMatch(/not a meter reading/);
    const bytes = buildShotListPdf(project, [variant, v1], {
      appUrl: 'https://lightmap.test',
      generatedAt: new Date('2026-06-01T12:00:00Z'),
      thumbnails,
    });
    const s = latin1(bytes);
    expect(s).toContain('/Title <FEFF');
    expect(s).toContain('/Width 320 /Height 180');
    expect(s).toContain('(Beach, noon) Tj');
  });
});
