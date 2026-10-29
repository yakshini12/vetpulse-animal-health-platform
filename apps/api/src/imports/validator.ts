/**
 * Contract with the Python CSV validator (../data-service/vetpulse_csv).
 *
 * Python is responsible for ROW-LEVEL validation only: required fields,
 * formats, enum values, date parsing/chronology, intra-file duplicates.
 * It never touches the database.
 *
 * Node performs DATABASE-LEVEL checks (case references, existing sample codes)
 * and the transactional import. The two stages are combined into one report.
 *
 * Invocation:  python -m vetpulse_csv.cli --file <path> [--max-rows 5000] [--chart out.png]
 * Success:     exit 0, a JSON ValidationReport on stdout
 * Bad file:    exit 2, a JSON {"error": "..."} object on stdout
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface RowError {
  field: string;
  code: string;
  message: string;
}

export interface ReportRow {
  row: number; // 1-based file row (header is row 1)
  sampleCode: string;
  caseNumber: string;
  outcome: 'VALID' | 'REJECTED' | 'DUPLICATE';
  errors: RowError[];
  data: Record<string, string>;
}

export interface ValidationReport {
  fileName: string;
  summary: { totalRows: number; valid: number; rejected: number; duplicates: number };
  rows: ReportRow[];
}

function dataServiceDir(): string {
  return process.env.DATA_SERVICE_DIR
    ? // Custom location (e.g. CI checkouts)
      process.env.DATA_SERVICE_DIR
    : path.resolve(process.cwd(), '../../data-service');
}

export async function runPythonValidator(csvBuffer: Buffer, fileName: string): Promise<ValidationReport> {
  const tempPath = path.join(os.tmpdir(), `vetpulse-import-${Date.now()}-${Math.round(Math.random() * 1e6)}.csv`);
  await fs.writeFile(tempPath, csvBuffer);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.pythonBin, ['-m', 'vetpulse_csv.cli', '--file', tempPath, '--max-rows', String(config.maxCsvRows)], {
        cwd: dataServiceDir(),
        windowsHide: true,
      });
      let out = '';
      let errOut = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (errOut += chunk));
      child.on('error', (err) => reject(new AppError(503, 'PYTHON_VALIDATOR_UNAVAILABLE', `The Python CSV validator could not be started: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve(out);
          return;
        }
        // Structured bad-file responses keep the failure readable in the UI.
        const parsed = safeJson(out);
        if (parsed && typeof parsed.error === 'string') {
          reject(new AppError(400, 'INVALID_CSV', parsed.error));
          return;
        }
        reject(
          new AppError(503, 'PYTHON_VALIDATOR_ERROR', `The CSV validator exited with code ${code}.`, {
            // Short stderr excerpt only; no stack traces or environment data.
            detail: errOut.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 500),
          }),
        );
      });
    });
    const report = safeJson(stdout) as ValidationReport | null;
    if (!report || typeof report.summary?.totalRows !== 'number' || !Array.isArray(report.rows)) {
      throw new AppError(503, 'PYTHON_VALIDATOR_ERROR', 'The CSV validator returned an unreadable report.');
    }
    report.fileName = fileName;
    return report;
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reads a CSV column from a report row; CSV data is always present (validated by python). */
export function readCsvColumn(row: ReportRow, column: string): string {
  return row.data[column] ?? '';
}

/**
 * Database-level checks merged into the python report before it is stored.
 * - rows referencing a case_number that does not exist → REJECTED (UNKNOWN_CASE)
 * - rows whose sample_code already exists in the DB → DUPLICATE (SAMPLE_EXISTS)
 */
export async function applyDatabaseChecks(
  report: ValidationReport,
  findDuplicates: { sample: (codes: string[]) => Promise<Set<string>>; cases: (numbers: string[]) => Promise<Set<string>> },
): Promise<void> {
  const validRows = report.rows.filter((row) => row.outcome === 'VALID');
  if (validRows.length === 0) return;

  const [existingSamples, existingCases] = await Promise.all([
    findDuplicates.sample(validRows.map((row) => readCsvColumn(row, 'sample_code'))),
    findDuplicates.cases([...new Set(validRows.map((row) => readCsvColumn(row, 'case_number')))]),
  ]);

  for (const row of validRows) {
    if (existingSamples.has(readCsvColumn(row, 'sample_code'))) {
      row.outcome = 'DUPLICATE';
      row.errors.push({ field: 'sample_code', code: 'SAMPLE_EXISTS', message: 'A sample with this ID already exists in the database.' });
    } else if (!existingCases.has(readCsvColumn(row, 'case_number'))) {
      row.outcome = 'REJECTED';
      row.errors.push({ field: 'case_number', code: 'UNKNOWN_CASE', message: `Case ${readCsvColumn(row, 'case_number')} does not exist. Import the case first.` });
    } else {
      row.outcome = 'VALID';
    }
  }
  recountSummary(report);
}

export function recountSummary(report: ValidationReport): void {
  report.summary = {
    totalRows: report.rows.length,
    valid: report.rows.filter((row) => row.outcome === 'VALID').length,
    rejected: report.rows.filter((row) => row.outcome === 'REJECTED').length,
    duplicates: report.rows.filter((row) => row.outcome === 'DUPLICATE').length,
  };
}
