/**
 * The shot list as a PDF (Pro, with the text and the calendar): the same blocks as the text
 * list, in Courier so the columns hold, with each saved viewpoint's own thumbnail under its
 * block — the picture the planner saved, not a new render. Pure: the thumbnails arrive as JPEG
 * bytes (the component converts the saved data URLs), so the composition is unit-tested.
 */
import { brand } from '@lightmap/config';
import type { ProjectDto, ViewpointDto } from '@/lib/api-types';
import { buildPdf, type PdfBlock, type PdfImage } from './pdf';
import { shotBlock, type ShotListOptions } from './shot-list';

export interface ShotListPdfOptions extends ShotListOptions {
  /** JPEG thumbnails by viewpoint id; a viewpoint without one gets text alone. */
  thumbnails?: ReadonlyMap<string, PdfImage>;
}

/** The PDF's blocks: a heading, the notes, one block per viewpoint (variants indented), the footer. */
export function shotListPdfBlocks(
  project: ProjectDto,
  viewpoints: readonly ViewpointDto[],
  opts: ShotListPdfOptions,
): PdfBlock[] {
  const byTime = (a: ViewpointDto, b: ViewpointDto) =>
    Date.parse(a.selectedDatetimeUtc) - Date.parse(b.selectedDatetimeUtc);
  const ids = new Set(viewpoints.map((v) => v.id));
  const parents = viewpoints
    .filter((v) => !v.parentViewpointId || !ids.has(v.parentViewpointId))
    .sort(byTime);
  const blocks: PdfBlock[] = [
    {
      heading: true,
      lines: [
        `${project.name} — shot list`,
        ...(project.shootDate ? [`Shoot date: ${project.shootDate}`] : []),
        `${viewpoints.length} viewpoint${viewpoints.length === 1 ? '' : 's'} · made with ${brand.name} · ${opts.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      ],
    },
  ];
  if (project.description)
    blocks.push({ lines: ['Notes:', ...project.description.split('\n').map((l) => `  ${l}`)] });
  const block = (v: ViewpointDto, indent: string): PdfBlock => ({
    heading: indent === '',
    lines: shotBlock(v, opts.appUrl, opts.units, opts.forecastAround).map((l) => `${indent}${l}`),
    image: opts.thumbnails?.get(v.id) ?? null,
    imageWidthPt: indent === '' ? 240 : 180,
  });
  for (const p of parents) {
    blocks.push(block(p, ''));
    for (const v of viewpoints.filter((x) => x.parentViewpointId === p.id).sort(byTime))
      blocks.push(block(v, '    '));
  }
  blocks.push({
    lines: [
      'Sun and Moon from ephemeris; the Milky Way core from geometry (no sky-brightness model). Weather lines say what the viewpoint was saved with — a scenario is not a forecast. Light is an incident-light estimate (no light pollution), not a meter reading. Pictures are the planner’s saved previews.',
      `${opts.appUrl}`,
    ],
  });
  return blocks;
}

export function buildShotListPdf(
  project: ProjectDto,
  viewpoints: readonly ViewpointDto[],
  opts: ShotListPdfOptions,
): Uint8Array<ArrayBuffer> {
  return buildPdf(shotListPdfBlocks(project, viewpoints, opts), {
    title: `${project.name} — shot list`,
    author: brand.name,
    createdAt: opts.generatedAt,
  });
}
