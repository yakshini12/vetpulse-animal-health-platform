/**
 * Business-facing code generators. Codes are generated inside the same
 * transaction as the record creation and protected by unique constraints;
 * a pad-started per-year sequence keeps the format stable and readable.
 */
export function caseNumberFor(year: number, sequence: number): string {
  return `CASE-${year}-${String(sequence).padStart(4, '0')}`;
}

export function sampleCodeFor(year: number, sequence: number): string {
  return `SP-${year}-${String(sequence).padStart(4, '0')}`;
}

export const CASE_NUMBER_PATTERN = /^CASE-\d{4}-\d{4}/;
export const SAMPLE_CODE_PATTERN = /^SP-\d{4}-\d{4}$/i;
