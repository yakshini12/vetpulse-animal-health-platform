import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api/client.js';
import type { AuditEventRecord, Page } from '../api/types.js';
import { Empty, ErrorAlert, Loading, Pager, SortTh } from '../components/ui.js';
import { formatDateTime, humanize } from '../lib/format.js';

const TARGET_TYPES = ['CASE', 'SAMPLE', 'TASK', 'IMPORT_BATCH', 'USER'] as const;

export function Audit() {
  const [filters, setFilters] = useState<{ search: string; targetType: string; sort: string; order: 'asc' | 'desc'; page: number }>({ search: '', targetType: '', sort: 'createdAt', order: 'desc', page: 1 });
  const [data, setData] = useState<Page<AuditEventRecord> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback((current: typeof filters) => {
    setData(null);
    api
      .get<Page<AuditEventRecord>>(
        `/api/audit${qs({
          eventType: current.search || undefined,
          targetType: current.targetType || undefined,
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

  function patch(next: Partial<typeof filters>) {
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
          <h1>Audit Trail</h1>
          <p>Append-only record of who changed what, when. Kept in the database, not editable from the app.</p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div>
            <label htmlFor="audit-search">Event type contains</label>
            <input
              id="audit-search"
              placeholder="e.g. TRANSITION"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
            />
          </div>
          <div>
            <label>Target type</label>
            <select value={filters.targetType} onChange={(e) => patch({ targetType: e.target.value })}>
              <option value="">All</option>
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <ErrorAlert error={error} />
        {!data && !error && <Loading />}
        {data && data.total === 0 && <Empty>No audit events match the current filters.</Empty>}
        {data && data.total > 0 && (
          <>
            <table className="data">
              <thead>
                <tr>
                  <SortTh field="createdAt" label="When" current={filters.sort} order={filters.order} onChange={onSort} />
                  <th>Actor</th>
                  <th>Event</th>
                  <th>Target</th>
                  <th>Summary</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td>{event.actorName}</td>
                    <td>{humanize(event.eventType)}</td>
                    <td className="mono">{event.targetType}</td>
                    <td>
                      {event.summary}
                      {expanded === event.id && event.meta != null && (
                        <pre style={{ fontSize: 11, background: '#f1f5f9', padding: 8, borderRadius: 6, overflow: 'auto' }}>
                          {JSON.stringify(event.meta, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                        {expanded === event.id ? 'Hide meta' : 'View meta'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager data={data} onPage={(page) => patch({ page })} />
          </>
        )}
      </div>
    </>
  );
}
