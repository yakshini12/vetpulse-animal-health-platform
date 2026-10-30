import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import type { AuditEventRecord, ResultStatus, SampleRecord, TaskRecord } from '../api/types.js';
import { Badge, Empty, ErrorAlert, Field, Loading, Modal, OkAlert } from '../components/ui.js';
import { SAMPLE_TRANSITIONS } from '../lib/transitions.js';
import { formatDate, formatDateTime, humanize } from '../lib/format.js';

const LOCKED_TEMPLATE =
  'Sample metadata is locked once processing has started. Only RECEIVED and IN_PROCESS samples can be edited.';

export function SampleDetail() {
  const { id } = useParams();
  const [record, setRecord] = useState<{ sample: SampleRecord; audit: AuditEventRecord[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api
      .get<{ sample: SampleRecord; audit: AuditEventRecord[] }>(`/api/samples/${id}`)
      .then(setRecord)
      .catch(setError);
  }, [id]);

  useEffect(load, [load]);

  if (error && !record) return <ErrorAlert error={error} />;
  if (!record) return <Loading />;
  const { sample: item, audit } = record;
  const editable = item.status === 'RECEIVED' || item.status === 'IN_PROCESS';
  const nextStatuses = SAMPLE_TRANSITIONS[item.status];
  const canRecordResult = item.status === 'IN_REVIEW' || item.status === 'COMPLETED';

  async function transition(to: string, rejectionReason?: string) {
    setActionError(null);
    setNotice(null);
    try {
      await api.post(`/api/samples/${item.id}/transition`, { to, rejectionReason });
      setNotice(`Sample moved to ${humanize(to)}.${to === 'COMPLETED' || to === 'REJECTED' ? ' This state is terminal.' : ''}`);
      setRejectOpen(false);
      load();
    } catch (err) {
      setRejectOpen(false);
      setActionError(err);
    }
  }

  async function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setActionError(null);
    setNotice(null);
    try {
      await api.post(`/api/samples/${item.id}/result`, {
        resultStatus: String(form.get('resultStatus')),
        resultSummary: String(form.get('resultSummary')),
      });
      setResultOpen(false);
      setNotice('Result recorded.');
      load();
    } catch (err) {
      setResultOpen(false);
      setActionError(err);
    }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setActionError(null);
    setNotice(null);
    try {
      await api.patch(`/api/samples/${item.id}`, {
        sampleType: String(form.get('sampleType')),
        collectionDate: String(form.get('collectionDate')),
        labLocation: String(form.get('labLocation')),
        notes: String(form.get('notes')),
      });
      setNotice('Sample metadata updated.');
      load();
    } catch (err) {
      setActionError(err);
    }
  }

  const tasks: TaskRecord[] = Array.isArray(item.tasks) ? item.tasks : [];

  return (
    <>
      <nav className="muted" style={{ marginBottom: 6 }}>
        <Link to="/samples">← All samples</Link>
        {item.case && (
          <>
            {' · '}
            <Link to={`/cases/${item.case.id}`} className="mono">{item.case.caseNumber}</Link>
          </>
        )}
      </nav>
      <div className="page-head">
        <div>
          <h1>
            <span className="mono" style={{ marginRight: 10 }}>{item.sampleCode}</span>
            <Badge value={item.status} />
          </h1>
          <p>{item.sampleType} sample collected {formatDate(item.collectionDate)} at {item.labLocation}</p>
        </div>
        <div className="row-actions">
          {nextStatuses.map((to) => (
            <button
              key={to}
              type="button"
              className={`btn btn-sm${to === 'REJECTED' ? ' btn-danger' : ''}`}
              onClick={() => (to === 'REJECTED' ? setRejectOpen(true) : transition(to))}
            >
              → {humanize(to)}
            </button>
          ))}
          {canRecordResult && (
            <button type="button" className="btn btn-sm" onClick={() => setResultOpen(true)}>
              Record result
            </button>
          )}
        </div>
      </div>

      <OkAlert>{notice}</OkAlert>
      <ErrorAlert error={actionError} />

      <div className="grid-2">
        <div className="card">
          <h2>Metadata</h2>
          <dl className="meta-grid">
            <div>
              <dt>Sample code</dt>
              <dd className="mono">{item.sampleCode}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{item.sampleType}</dd>
            </div>
            <div>
              <dt>Result status</dt>
              <dd><Badge value={item.resultStatus} /></dd>
            </div>
            <div>
              <dt>Collected</dt>
              <dd>{formatDate(item.collectionDate)}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{formatDate(item.receivedAt)}</dd>
            </div>
            <div>
              <dt>Processing started</dt>
              <dd>{formatDate(item.processingStartedAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{formatDate(item.completedAt)}</dd>
            </div>
            <div>
              <dt>Rejected</dt>
              <dd>
                {formatDate(item.rejectedAt)}
                {item.rejectionReason ? ` — ${item.rejectionReason}` : ''}
              </dd>
            </div>
          </dl>
          <div style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 6 }}>Notes</h3>
            <p style={{ margin: 0 }}>{item.notes ?? <span className="muted">None.</span>}</p>
          </div>
          {editable && (
            <p style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => setEditOpen(true)}>
                Edit metadata
              </button>
            </p>
          )}
          {!editable && <p className="muted" style={{ fontSize: 12 }}>{LOCKED_TEMPLATE}</p>}
        </div>

        <div>
          <div className="card">
            <h2>Result summary</h2>
            {item.resultSummary ? (
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.resultSummary}</p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {item.resultStatus === 'NOT_AVAILABLE'
                  ? 'No result recorded yet. Results open once the sample reaches IN_REVIEW.'
                  : 'Result status set, but no summary text yet.'}
              </p>
            )}
            {canRecordResult && (
              <p style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => setResultOpen(true)}>
                  Update result
                </button>
              </p>
            )}
          </div>
          <div className="card">
            <h2>Audit history (latest 25)</h2>
            {audit.length === 0 ? (
              <Empty>No recorded events for this sample.</Empty>
            ) : (
              <ul className="activity">
                {audit.map((event) => (
                  <li key={event.id}>
                    {event.summary}
                    <div className="when">
                      <strong>{event.actorName}</strong> · {formatDateTime(event.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Linked tasks</h2>
        {tasks.length === 0 ? (
          <Empty>No tasks reference this sample.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Due</th>
                <th>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <Link to="/tasks">{task.title}</Link>
                  </td>
                  <td><Badge value={task.status} /></td>
                  <td>{formatDate(task.dueDate)}</td>
                  <td>{task.assignee?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal title={`Reject ${item.sampleCode}`} open={rejectOpen} onClose={() => setRejectOpen(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void transition('REJECTED', String(form.get('rejectionReason')));
          }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Rejection is terminal from IN_PROCESS or IN_REVIEW. A REJECTED sample can never be completed.
          </p>
          <Field label="Rejection reason" hint="Minimum 5 characters; stored on the audit trail">
            <textarea name="rejectionReason" required minLength={5} maxLength={500} />
          </Field>
          <div className="sticky-foot">
            <button type="submit" className="btn btn-danger">
              Reject sample
            </button>
            <button type="button" className="btn" onClick={() => setRejectOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal title={`Record result — ${item.sampleCode}`} open={resultOpen} onClose={() => setResultOpen(false)}>
        <form onSubmit={saveResult}>
          <Field label="Result status" hint="RELEASED requires the sample to be COMPLETED and needs a summary">
            <select name="resultStatus" defaultValue={item.resultStatus}>
              {(['NOT_AVAILABLE', 'PENDING', 'RELEASED'] as ResultStatus[]).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Result summary">
            <textarea name="resultSummary" maxLength={1000} defaultValue={item.resultSummary ?? ''} />
          </Field>
          <ErrorAlert error={actionError} />
          <div className="sticky-foot">
            <button type="submit" className="btn btn-primary">
              Save result
            </button>
            <button type="button" className="btn" onClick={() => setResultOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal title={`Edit metadata — ${item.sampleCode}`} open={editOpen} onClose={() => setEditOpen(false)}>
        <form onSubmit={saveMetadata}>
          <div className="grid-2">
            <Field label="Sample type">
              <select name="sampleType" defaultValue={item.sampleType}>
                {(['BLOOD', 'SWAB', 'TISSUE', 'URINE', 'FECAL', 'MILK', 'OTHER'] as const).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Collection date" hint="Cannot be in the future">
              <input name="collectionDate" type="date" defaultValue={item.collectionDate.slice(0, 10)} required />
            </Field>
          </div>
          <Field label="Lab / location">
            <input name="labLocation" defaultValue={item.labLocation} required minLength={2} maxLength={80} />
          </Field>
          <Field label="Notes">
            <textarea name="notes" maxLength={1000} defaultValue={item.notes ?? ''} />
          </Field>
          <div className="sticky-foot">
            <button type="submit" className="btn btn-primary">
              Save metadata
            </button>
            <button type="button" className="btn" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
