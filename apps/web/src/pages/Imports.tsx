import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadCsv } from '../api/client.js';
import type { ImportBatchSummary, ValidationReport } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Loading, OkAlert, Pager } from '../components/ui.js';
import { formatDateTime } from '../lib/format.js';

/**
 * The Data Imports page is the human-facing half of the documented pipeline:
 *   1. PREVIEW — upload a CSV; the Go-style Python service validates each row
 *      and Node adds database-level checks (UNKNOWN_CASE, SAMPLE_EXISTS).
 *   2. COMMIT — valid rows only, inserted atomically, or nothing at all.
 */
export function Imports() {
  const [report, setReport] = useState<{ import: ImportBatchSummary; report: ValidationReport } | null>(null);
  const [history, setHistory] = useState<PageShape | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [filterRow, setFilterRow] = useState<'ALL' | 'VALID' | 'REJECTED' | 'DUPLICATE'>('ALL');
  const fileInput = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback((current: number) => {
    api
      .get<PageShape>(`/api/imports?page=${current}&pageSize=10`)
      .then(setHistory)
      .catch(setError);
  }, []);

  useEffect(() => {
    loadHistory(page);
  }, [page, loadHistory]);

  async function onPreview(event: React.FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setActionError(new Error('Choose a .csv file first.'));
      return;
    }
    setBusy(true);
    setError(null);
    setActionError(null);
    setNotice(null);
    setReport(null);
    try {
      const uploaded = await uploadCsv<{ import: ImportBatchSummary; report: ValidationReport }>('/api/imports/preview', file);
      setReport(uploaded);
      setFilterRow('ALL');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!report) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const committed = await api.post<{ import: ImportBatchSummary; inserted: number }>(
        `/api/imports/${report.import.id}/commit`,
      );
      setNotice(
        `Imported ${committed.inserted} sample${committed.inserted === 1 ? '' : 's'} from ${committed.import.fileName}. ` +
          'Committed atomically — any failure rolls back everything.',
      );
      setReport(null);
      if (fileInput.current) fileInput.current.value = '';
      setPage(1);
      loadHistory(1);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const validRows = report?.report.rows.filter((row) => row.outcome === 'VALID').length ?? 0;
  const previewed = report?.import.status === 'PREVIEWED';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data Imports</h1>
          <p>
            Two-step, audited import: validate first, commit later. Python checks row formats; postgres checks
            case references and duplicate sample codes.
          </p>
        </div>
      </div>

      {notice && <OkAlert>{notice}</OkAlert>}
      <ErrorAlert error={actionError} />

      <div className="card">
        <h2>Step 1 — Preview a CSV</h2>
        <form onSubmit={onPreview} className="filter-row">
          <input type="file" accept=".csv" ref={fileInput} style={{ maxWidth: 320 }} />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && !report ? 'Validating…' : 'Validate file'}
          </button>
          {previewed && (
            <button type="button" className="btn" onClick={onCommit} disabled={busy || validRows === 0}>
              {validRows === 0 ? 'Nothing valid to commit' : `Step 2 — Commit ${validRows} valid row${validRows === 1 ? '' : 's'}`}
            </button>
          )}
        </form>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Columns required: sample_code, case_number, sample_type, collection_date, status, lab_location
          (+ optional received_date, processing_started_date, completed_date, rejected_date, rejection_reason,
          result_status, result_summary, notes). One row per sample.
        </p>
      </div>

      {report && (
        <div className="card">
          <h2>Validation report — {report.report.fileName}</h2>
          <div className="kpis">
            <div className="kpi">
              <div className="muted">Total rows</div>
              <div className="value">{report.report.summary.totalRows}</div>
            </div>
            <div className="kpi">
              <div className="muted">Valid</div>
              <div className="value">{report.report.summary.valid}</div>
            </div>
            <div className="kpi flag">
              <div className="muted">Rejected</div>
              <div className="value">{report.report.summary.rejected}</div>
            </div>
            <div className="kpi">
              <div className="muted">Duplicates</div>
              <div className="value">{report.report.summary.duplicates}</div>
            </div>
          </div>
          <div className="toolbar">
            <div>
              <label>Row outcome</label>
              <select value={filterRow} onChange={(e) => setFilterRow(e.target.value as typeof filterRow)}>
                <option value="ALL">All rows</option>
                <option value="VALID">Valid only</option>
                <option value="REJECTED">Rejected only</option>
                <option value="DUPLICATE">Duplicates only</option>
              </select>
            </div>
          </div>
          {report.report.rows.length === 0 ? (
            <Empty>The file parsed to zero data rows.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Sample code</th>
                  <th>Case</th>
                  <th>Outcome</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {report.report.rows
                  .filter((row) => filterRow === 'ALL' || row.outcome === filterRow)
                  .map((row) => (
                    <tr key={row.row} className={row.outcome === 'VALID' ? '' : 'report-row-invalid'}>
                      <td>{row.row}</td>
                      <td className="mono">{row.sampleCode || '—'}</td>
                      <td className="mono">{row.caseNumber || '—'}</td>
                      <td>
                        {row.outcome === 'VALID' ? (
                          <span className="badge badge-good">Valid</span>
                        ) : row.outcome === 'DUPLICATE' ? (
                          <span className="badge badge-warn">Duplicate</span>
                        ) : (
                          <span className="badge badge-bad">Rejected</span>
                        )}
                      </td>
                      <td>
                        {row.errors.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <ul className="error-list">
                            {row.errors.map((err, index) => (
                              <li key={index}>
                                <span className="mono">{err.code}</span> · {err.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card">
        <h2>Import history</h2>
        <ErrorAlert error={error} />
        {!history && <Loading />}
        {history && history.total === 0 && <Empty>No imports attempted yet.</Empty>}
        {history && history.total > 0 && (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Valid</th>
                  <th>Rejected</th>
                  <th>Duplicates</th>
                  <th>Inserted</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.fileName}</td>
                    <td><Badge value={batch.status} /></td>
                    <td>{batch.counts.total}</td>
                    <td>{batch.counts.valid}</td>
                    <td>{batch.counts.rejected}</td>
                    <td>{batch.counts.duplicates}</td>
                    <td>{batch.counts.inserted}</td>
                    <td>{batch.createdByName ?? '—'}</td>
                    <td>{formatDateTime(batch.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager data={history} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

interface PageShape {
  items: ImportBatchSummary[];
  page: number;
  total: number;
  totalPages: number;
}

export type { PageShape as ImportHistoryPage };
