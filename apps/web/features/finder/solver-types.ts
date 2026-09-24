import type { DirectionMatch, SolverInput } from '@lightmap/astronomy';

/** What crosses the worker boundary (structured clone: no Dates on the way back). */
export interface SolverRequest {
  id: number;
  input: SolverInput;
}

export interface SerializedMatch extends Omit<DirectionMatch, 'timestampUtc'> {
  timestampUtc: string;
}

export interface SolverResultDto {
  scannedDays: number;
  truncated: boolean;
  matches: SerializedMatch[];
  alignmentCount: number;
}

export type SolverResponse =
  { id: number; ok: true; result: SolverResultDto } | { id: number; ok: false; error: string };
