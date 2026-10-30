import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api/client.js';
import type { Page, TaskPriority, TaskRecord, TaskStatus } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Field, Loading, Modal, Pager, SortTh } from '../components/ui.js';
import { TASK_TRANSITIONS } from '../lib/transitions.js';
import { formatDate } from '../lib/format.js';

interface Filters {
  search: string;
  status: '' | TaskStatus;
  overdue: '' | 'true';
  assignee: string;
  caseId: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
}

export function Tasks() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({
    search: '',
    status: '',
    overdue: '',
    assignee: '',
    caseId: params.get('caseId') ?? '',
    sort: 'dueDate',
    order: 'asc',
    page: 1,
  }));
  const [data, setData] = useState<Page<TaskRecord> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback((current: Filters) => {
    setData(null);
    api
      .get<Page<TaskRecord>>(
        `/api/tasks${qs({
          search: current.search || undefined,
          status: current.status || undefined,
          overdue: current.overdue || undefined,
          assignee: current.assignee || undefined,
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

  async function transition(task: TaskRecord, to: TaskStatus) {
    setActionError(null);
    try {
      await api.patch(`/api/tasks/${task.id}`, { status: to });
      load(filters);
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Follow-up Tasks</h1>
          <p>TODO / in-progress / done with full transitions — the server records every change on the audit trail.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + New task
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <div>
            <label htmlFor="task-search">Search</label>
            <input
              id="task-search"
              placeholder="Title or description"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
            />
          </div>
          <div>
            <label>Status</label>
            <select value={filters.status} onChange={(e) => patch({ status: e.target.value as Filters['status'] })}>
              <option value="">All</option>
              {(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as TaskStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Due</label>
            <select value={filters.overdue} onChange={(e) => patch({ overdue: e.target.value as Filters['overdue'] })}>
              <option value="">Everything</option>
              <option value="true">Overdue only</option>
            </select>
          </div>
          <div>
            <label>Assignee contains</label>
            <input style={{ minWidth: 150 }} value={filters.assignee} onChange={(e) => patch({ assignee: e.target.value })} />
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
        <ErrorAlert error={actionError} />
        {!data && !error && <Loading />}
        {data && data.total === 0 && <Empty>No tasks match the current filters.</Empty>}
        {data && data.total > 0 && (
          <>
            <table className="data">
              <thead>
                <tr>
                  <SortTh field="priorityRank" label="Prio" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="title" label="Title" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="status" label="Status" current={filters.sort} order={filters.order} onChange={onSort} />
                  <SortTh field="dueDate" label="Due" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Assignee</th>
                  <th>Linked to</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td><Badge value={row.priority} /></td>
                    <td>
                      {row.title}
                      {row.isOverdue && (
                        <span className="badge badge-bad" style={{ marginLeft: 8 }}>Overdue</span>
                      )}
                      {row.description && (
                        <div className="muted" style={{ fontSize: 12 }}>{row.description}</div>
                      )}
                    </td>
                    <td><Badge value={row.status} /></td>
                    <td>{formatDate(row.dueDate)}</td>
                    <td>{row.assignee?.name ?? '—'}</td>
                    <td>
                      {row.case && (
                        <Link to={`/cases/${row.case.id}`} className="mono">{row.case.caseNumber}</Link>
                      )}
                      {row.case && row.sample && ' · '}
                      {row.sample && (
                        <Link to={`/samples/${row.sample.id}`} className="mono">{row.sample.sampleCode}</Link>
                      )}
                      {!row.case && !row.sample && <span className="muted">Standalone</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {TASK_TRANSITIONS[row.status].map((to) => (
                          <button key={to} type="button" className="btn btn-sm" onClick={() => transition(row, to)}>
                            {to === 'DONE' ? '✓ Done' : to === 'CANCELLED' ? 'Cancel' : `→ ${to}`}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager data={data} onPage={(page) => patch({ page })} />
          </>
        )}
      </div>

      <CreateTaskModal open={createOpen} defaultCaseId={filters.caseId} onClose={() => setCreateOpen(false)} onCreated={() => load(filters)} />
    </>
  );
}

function CreateTaskModal({
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
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [cases, setCases] = useState<{ id: string; caseNumber: string; title: string }[]>([]);
  const [samples, setSamples] = useState<{ id: string; sampleCode: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSamples([]);
    api.get<Page<{ id: string; name: string; email: string }>>('/api/users').then((res) => setUsers(res.items)).catch(() => {});
    api
      .get<Page<{ id: string; caseNumber: string; title: string }>>('/api/cases?page=1&pageSize=100&sort=caseNumber&order=desc')
      .then((res) => setCases(res.items))
      .catch(() => {});
  }, [open]);

  function onCasePick(value: string) {
    const selection = cases.find((entry) => entry.id === value) ?? null;
    if (!selection) {
      setSamples([]);
      return;
    }
    api
      .get<Page<{ id: string; sampleCode: string }>>('/api/samples?caseId=' + encodeURIComponent(value) + '&pageSize=100')
      .then((res) => setSamples(res.items))
      .catch(() => setSamples([]));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const caseId = String(form.get('caseId'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/tasks', {
        title: String(form.get('title')),
        description: String(form.get('description')) || null,
        priority: String(form.get('priority')),
        dueDate: String(form.get('dueDate')),
        caseId: caseId || null,
        sampleId: String(form.get('sampleId')) || null,
        assigneeId: String(form.get('assigneeId')) || null,
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
    <Modal title="Create a task" open={open} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Field label="Title">
          <input name="title" required minLength={3} maxLength={140} />
        </Field>
        <Field label="Description (optional)">
          <textarea name="description" maxLength={2000} />
        </Field>
        <div className="grid-2">
          <Field label="Priority">
            <select name="priority" defaultValue="MEDIUM">
              {(['LOW', 'MEDIUM', 'HIGH'] as TaskPriority[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input name="dueDate" type="date" required />
          </Field>
        </div>
        <Field label="Link to case (optional)">
          <select name="caseId" defaultValue={defaultCaseId} onChange={(e) => onCasePick(e.target.value)}>
            <option value="">No case</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.caseNumber} — {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to sample (optional)" hint="Pick a case first to see its samples">
          <select name="sampleId" defaultValue="" key={samples.length}>
            <option value="">No sample</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>{s.sampleCode}</option>
            ))}
          </select>
        </Field>
        <Field label="Assign to">
          <select name="assigneeId" defaultValue="">
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <ErrorAlert error={error} />
        <div className="sticky-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create task'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

