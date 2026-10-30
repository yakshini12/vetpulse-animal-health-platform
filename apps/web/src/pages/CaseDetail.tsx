import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { CaseDetailRecord, CaseStatus, TaskRecord } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Field, Loading, Modal, OkAlert } from '../components/ui.js';
import { CASE_TRANSITIONS } from '../lib/transitions.js';
import { formatDate, formatDateTime, humanize } from '../lib/format.js';

interface AuditRow {
  id: string;
  eventType: string;
  summary: string;
  actorName: string;
  createdAt: string;
}

export function CaseDetail() {
  const { id } = useParams();
  const [record, setRecord] = useState<{ case: CaseDetailRecord; audit: AuditRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<{ case: CaseDetailRecord; audit: AuditRow[] }>(`/api/cases/${id}`)
      .then(setRecord)
      .catch(setError);
  }, [id]);

  useEffect(load, [load]);

  if (error && !record) return <ErrorAlert error={error} />;
  if (!record) return <Loading />;
  const { case: item, audit } = record;

  const transitions = CASE_TRANSITIONS[item.status];

  async function transition(to: CaseStatus) {
    setActionError(null);
    setNotice(null);
    try {
      await api.patch(`/api/cases/${item.id}`, { status: to });
      setNotice(`Case moved to ${humanize(to)}.${to === 'CLOSED' ? ' CLOSED is terminal — the case can no longer change.' : ''}`);
      load();
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <>
      <nav className="muted" style={{ marginBottom: 6 }}>
        <Link to="/cases">← All cases</Link>
      </nav>
      <div className="page-head">
        <div>
          <h1>
            <span className="mono" style={{ marginRight: 10 }}>{item.caseNumber}</span>
            {item.title}
          </h1>
          <p>
            {item.species}
            {item.breed ? ` · ${item.breed}` : ''}
            {item.ageMonths != null ? ` · ${item.ageMonths} mo` : ''} · owner <span className="mono">{item.ownerRef}</span>
          </p>
        </div>
        <div className="row-actions">
          {item.status === 'CLOSED' ? (
            <div className="muted">This case is closed and read-only.</div>
          ) : (
            <>
              {transitions.map((to) => (
                <button
                  key={to}
                  type="button"
                  className={`btn btn-sm${to === 'CLOSED' ? ' btn-danger' : ''}`}
                  onClick={() => transition(to)}
                >
                  → {humanize(to)}
                </button>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => setEditOpen(true)}>
                Edit details
              </button>
            </>
          )}
        </div>
      </div>

      <OkAlert>{notice}</OkAlert>
      <ErrorAlert error={actionError} />

      <div className="card">
        <h2>Details</h2>
        <dl className="meta-grid">
          <div>
            <dt>Status</dt>
            <dd><Badge value={item.status} /></dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd><Badge value={item.priority} /></dd>
          </div>
          <div>
            <dt>Assigned to</dt>
            <dd>{item.assignedTo?.name ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(item.createdAt)}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{formatDate(item.updatedAt)}</dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd>{formatDate(item.closedAt)}</dd>
          </div>
        </dl>
        <div style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 6 }}>Reported concern</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.concern}</p>
        </div>
      </div>

      <div className="card">
        <h2>
          Samples ({item.samples.length}){'  '}
          <Link to={`/samples?caseId=${item.id}`} style={{ float: 'right' }}>
            Register a sample →
          </Link>
        </h2>
        {item.samples.length === 0 ? (
          <Empty>No samples registered against this case yet.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Sample code</th>
                <th>Type</th>
                <th>Status</th>
                <th>Collected</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {item.samples.map((sample) => (
                <tr key={sample.id}>
                  <td>
                    <Link to={`/samples/${sample.id}`} className="mono">{sample.sampleCode}</Link>
                  </td>
                  <td>{sample.sampleType}</td>
                  <td><Badge value={sample.status} /></td>
                  <td>{formatDate(sample.collectionDate)}</td>
                  <td><Badge value={sample.resultStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TasksCard tasks={item.tasks} caseId={item.id} caseNumber={item.caseNumber} />
      <AuditCard audit={audit} />

      <EditCaseModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        item={item}
        onSaved={(message) => {
          setEditOpen(false);
          setNotice(message);
          load();
        }}
      />
    </>
  );
}

function TasksCard({ tasks, caseId, caseNumber }: { tasks: TaskRecord[]; caseId: string; caseNumber: string }) {
  return (
    <div className="card">
      <h2>
        Tasks ({tasks.length}){'  '}
        <Link to={`/tasks?caseId=${caseId}`} style={{ float: 'right' }}>
          View in task centre →
        </Link>
      </h2>
      {tasks.length === 0 ? (
        <Empty>No follow-up tasks for {caseNumber}.</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Assignee</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td><Badge value={task.status} /></td>
                <td><Badge value={task.priority} /></td>
                <td>{formatDate(task.dueDate)}</td>
                <td>{task.assignee?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AuditCard({ audit }: { audit: AuditRow[] }) {
  return (
    <div className="card">
      <h2>Audit history (latest 25)</h2>
      {audit.length === 0 ? (
        <Empty>No recorded events for this case.</Empty>
      ) : (
        <ul className="activity">
          {audit.map((event) => (
            <li key={event.id}>
              {event.summary}
              <div className="when">
                <strong>{humanize(event.eventType)}</strong> · {event.actorName} · {formatDateTime(event.createdAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditCaseModal({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: CaseDetailRecord;
  onSaved: (message: string) => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .get<{ items: { id: string; name: string; email: string }[] }>('/api/users')
      .then((res) => setUsers(res.items))
      .catch(() => {});
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/cases/${item.id}`, {
        title: String(form.get('title')),
        species: String(form.get('species')),
        breed: String(form.get('breed')) || null,
        ageMonths: form.get('ageMonths') ? Number(form.get('ageMonths')) : null,
        ownerRef: String(form.get('ownerRef')),
        concern: String(form.get('concern')),
        priority: String(form.get('priority')),
        assignedToId: String(form.get('assignedToId')) || null,
      });
      onSaved(`${item.caseNumber} updated.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit ${item.caseNumber}`} open={open} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <Field label="Title">
          <input name="title" defaultValue={item.title} required minLength={3} maxLength={160} />
        </Field>
        <div className="grid-2">
          <Field label="Species">
            <input name="species" defaultValue={item.species} required minLength={2} maxLength={60} />
          </Field>
          <Field label="Breed">
            <input name="breed" defaultValue={item.breed ?? ''} maxLength={80} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Age (months)">
            <input name="ageMonths" type="number" min={0} max={600} defaultValue={item.ageMonths ?? ''} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue={item.priority}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Owner reference" hint="Organisation code, e.g. ORG-117">
          <input name="ownerRef" defaultValue={item.ownerRef} required pattern="^ORG-[A-Z0-9-]{1,60}$" />
        </Field>
        <Field label="Reported concern">
          <textarea name="concern" defaultValue={item.concern} required minLength={5} maxLength={2000} />
        </Field>
        <Field label="Assign to">
          <select name="assignedToId" defaultValue={item.assignedTo?.id ?? ''}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <ErrorAlert error={error} />
        <div className="sticky-foot">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
