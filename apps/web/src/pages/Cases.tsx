import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import type { CaseListItem, CasePriority, CaseStatus, Page } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Field, Loading, Modal, Pager, SortTh } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface Filters {
  search: string;
  status: '' | CaseStatus;
  priority: '' | CasePriority;
  closed: '' | 'true' | 'false';
  sort: string;
  order: 'asc' | 'desc';
  page: number;
}

const DEFAULTS: Filters = { search: '', status: '', priority: '', closed: '', sort: 'createdAt', order: 'desc', page: 1 };

export function Cases() {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [data, setData] = useState<Page<CaseListItem> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback((current: Filters) => {
    setData(null);
    api
      .get<Page<CaseListItem>>(
        `/api/cases${qs({
          search: current.search || undefined,
          status: current.status || undefined,
          priority: current.priority || undefined,
          closed: current.closed || undefined,
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
          <h1>Animal Cases</h1>
          <p>Pseudonymous records only — organisation codes never personal names.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + New case
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <div>
            <label htmlFor="case-search">Search</label>
            <input
              id="case-search"
              placeholder="Title, case no, owner ORG-…"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
            />
          </div>
          <div>
            <label>Status</label>
            <select value={filters.status} onChange={(e) => patch({ status: e.target.value as Filters['status'] })}>
              <option value="">All</option>
              {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as CaseStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select value={filters.priority} onChange={(e) => patch({ priority: e.target.value as Filters['priority'] })}>
              <option value="">All</option>
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as CasePriority[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Resolution</label>
            <select value={filters.closed} onChange={(e) => patch({ closed: e.target.value as Filters['closed'] })}>
              <option value="">All</option>
              <option value="true">Open only (not resolved/closed)</option>
              <option value="false">Resolved/closed only</option>
            </select>
          </div>
        </div>

        <ErrorAlert error={error} />
        {!data && !error && <Loading />}
        {data && data.total === 0 && <Empty>No cases match the current filters.</Empty>}
        {data && data.total > 0 && (
          <>
            <table className="data">
              <thead>
                <tr>
                  <SortTh field="caseNumber" label="Case" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="title" label="Title" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Species</th>
                  <SortTh field="status" label="Status" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="priorityRank" label="Priority" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Owner</th>
                  <th>Assigned to</th>
                  <SortTh field="createdAt" label="Created" current={filters.sort} order={filters.order} onChange={onSort} />
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/cases/${row.id}`} className="mono">
                        {row.caseNumber}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/cases/${row.id}`}>{row.title}</Link>
                    </td>
                    <td>{row.species}</td>
                    <td>
                      <Badge value={row.status} />
                    </td>
                    <td>
                      <Badge value={row.priority} />
                    </td>
                    <td className="mono">{row.ownerRef}</td>
                    <td>{row.assignedTo?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td>{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager data={data} onPage={(page) => patch({ page })} />
          </>
        )}
      </div>

      <CreateCaseModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => load(filters)} />
    </>
  );
}

function CreateCaseModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setUsers([]);
    api
      .get<Page<{ id: string; name: string; email: string }>>('/api/users')
      .then((res) => setUsers(res.items))
      .catch(() => {}); // non-admins get 403; assignment stays optional
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/cases', {
        title: String(form.get('title')),
        species: String(form.get('species')),
        breed: String(form.get('breed')) || null,
        ageMonths: form.get('ageMonths') ? Number(form.get('ageMonths')) : null,
        ownerRef: String(form.get('ownerRef')),
        concern: String(form.get('concern')),
        priority: String(form.get('priority')),
        assignedToId: String(form.get('assignedToId')) || null,
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
    <Modal title="Register a new case" open={open} onClose={onClose}>
      <form onSubmit={onSubmit} id="case-form">
        <Field label="Title" hint="3–160 characters">
          <input name="title" required minLength={3} maxLength={160} />
        </Field>
        <div className="grid-2">
          <Field label="Species">
            <input name="species" required minLength={2} maxLength={60} placeholder="e.g. Cattle" />
          </Field>
          <Field label="Breed (optional)">
            <input name="breed" maxLength={80} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Age (months)" hint="Whole number, 0–600">
            <input name="ageMonths" type="number" min={0} max={600} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue="MEDIUM">
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Owner reference" hint="Organisation code, e.g. ORG-117 — never a personal name">
          <input name="ownerRef" required pattern="^ORG-[A-Z0-9-]{1,60}$" placeholder="ORG-117" />
        </Field>
        <Field label="Reported concern" hint="What was observed; 5–2000 characters">
          <textarea name="concern" required minLength={5} maxLength={2000} />
        </Field>
        <Field label="Assign to">
          <select name="assignedToId" defaultValue="">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <ErrorAlert error={error} />
        <div className="sticky-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create case'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

