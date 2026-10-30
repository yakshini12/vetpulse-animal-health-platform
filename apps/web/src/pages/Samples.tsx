import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import type { Page, ResultStatus, SampleRecord, SampleStatus, SampleType } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Field, Loading, Modal, Pager, SortTh } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface Filters {
  search: string;
  status: '' | SampleStatus;
  sampleType: '' | SampleType;
  resultStatus: '' | ResultStatus;
  caseId: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
}

export function Samples() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({
    search: '',
    status: '',
    sampleType: '',
    resultStatus: '',
    caseId: params.get('caseId') ?? '',
    sort: 'createdAt',
    order: 'desc',
    page: 1,
  }));
  const [data, setData] = useState<Page<SampleRecord> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const load = useCallback((current: Filters) => {
    setData(null);
    api
      .get<Page<SampleRecord>>(
        `/api/samples${qs({
          search: current.search || undefined,
          status: current.status || undefined,
          sampleType: current.sampleType || undefined,
          resultStatus: current.resultStatus || undefined,
          caseId: current.caseId || undefined,
          sort: current.sort,
          order: current.order,
          page: current.page,
        })}`,
      )
      .then(setData)
      .catch(setError);
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function patch(next: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...next, ...(next.page === undefined ? { page: 1 } : {}) }));
  }

  function onSort(field: string) {
    setFilters((prev) => ({
      ...prev,
      sort: field,
      order: prev.sort === field && prev.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diagnostic Samples</h1>
          <p>Every sample follows the documented pipeline: Received → In process → In review → Completed / Rejected.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setRegisterOpen(true)}>
          + Register sample
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <div>
            <label htmlFor="sample-search">Search</label>
            <input
              id="sample-search"
              placeholder="Code, case no, lab, notes"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
            />
          </div>
          <div>
            <label>Status</label>
            <select value={filters.status} onChange={(e) => patch({ status: e.target.value as Filters['status'] })}>
              <option value="">All</option>
              {(['RECEIVED', 'IN_PROCESS', 'IN_REVIEW', 'COMPLETED', 'REJECTED'] as SampleStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Type</label>
            <select value={filters.sampleType} onChange={(e) => patch({ sampleType: e.target.value as Filters['sampleType'] })}>
              <option value="">All</option>
              {(['BLOOD', 'SWAB', 'TISSUE', 'URINE', 'FECAL', 'MILK', 'OTHER'] as SampleType[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Result</label>
            <select value={filters.resultStatus} onChange={(e) => patch({ resultStatus: e.target.value as Filters['resultStatus'] })}>
              <option value="">All</option>
              {(['NOT_AVAILABLE', 'PENDING', 'RELEASED'] as ResultStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {filters.caseId && (
            <div>
              <label>Case filter</label>
              <button type="button" className="btn btn-sm" onClick={() => patch({ caseId: '' })}>
                Clear case filter ✕
              </button>
            </div>
          )}
        </div>

        <ErrorAlert error={error} />
        {!data && !error && <Loading />}
        {data && data.total === 0 && <Empty>No samples match the current filters.</Empty>}
        {data && data.total > 0 && (
          <>
            <table className="data">
              <thead>
                <tr>
                  <SortTh field="sampleCode" label="Code" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="collectionDate" label="Collected" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Type</th>
                  <SortTh field="status" label="Status" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Case</th>
                  <th>Lab</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/samples/${row.id}`} className="mono">{row.sampleCode}</Link>
                    </td>
                    <td>{formatDate(row.collectionDate)}</td>
                    <td>{row.sampleType}</td>
                    <td><Badge value={row.status} /></td>
                    <td>
                      {row.case && (
                        <Link to={`/cases/${row.case.id}`} className="mono">{row.case.caseNumber}</Link>
                      )}
                    </td>
                    <td>{row.labLocation}</td>
                    <td><Badge value={row.resultStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager data={data} onPage={(page) => patch({ page })} />
          </>
        )}
      </div>

      <RegisterSampleModal
        open={registerOpen}
        defaultCaseId={filters.caseId}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => load(filters)}
      />
    </>
  );
}

function RegisterSampleModal({
  open,
  defaultCaseId,
  onClose,
  onCreated,
}: {
  open: boolean;
  defaultCaseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [cases, setCases] = useState<{ id: string; caseNumber: string; title: string; status: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .get<Page<{ id: string; caseNumber: string; title: string; status: string }>>('/api/cases?page=1&pageSize=100&sort=caseNumber&order=desc')
      .then((res) => setCases(res.items))
      .catch(() => setCases([]));
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/samples', {
        caseId: String(form.get('caseId')),
        sampleType: String(form.get('sampleType')),
        collectionDate: String(form.get('collectionDate')),
        labLocation: String(form.get('labLocation')),
        notes: String(form.get('notes')),
      });
      onClose();
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Register a new sample" open={open} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Field label="Case" hint="Samples always belong to an existing case">
          <select name="caseId" defaultValue={defaultCaseId} required>
            <option value="" disabled>
              Select a case…
            </option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.caseNumber} — {c.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Sample type">
            <select name="sampleType" defaultValue="BLOOD">
              {['BLOOD', 'SWAB', 'TISSUE', 'URINE', 'FECAL', 'MILK', 'OTHER'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Collection date" hint="Cannot be in the future">
            <input name="collectionDate" type="date" required />
          </Field>
        </div>
        <Field label="Lab / location">
          <input name="labLocation" required minLength={2} maxLength={80} placeholder="District veterinary lab" />
        </Field>
        <Field label="Notes (optional)">
          <textarea name="notes" maxLength={1000} />
        </Field>
        <ErrorAlert error={error} />
        <div className="sticky-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Register sample'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
