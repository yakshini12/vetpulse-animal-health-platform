import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client.js';
import type { Role, UserRecord } from '../api/types.js';
import { useAuth } from '../auth/AuthContext.js';
import { Badge, ErrorAlert, Loading, OkAlert } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

/**
 * Admin-only user administration. The RPG guard on the server is authoritative;
 * this page only renders if the navigation link passed, and every PATCH is
 * double-checked server-side (an admin can never demote or deactivate self).
 */
export function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ items: UserRecord[] }>('/api/users')
      .then((res) => setUsers(res.items))
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  async function update(target: UserRecord, patch: { role?: Role; isActive?: boolean }) {
    setActionError(null);
    setNotice(null);
    try {
      await api.patch(`/api/users/${target.id}`, patch);
      setNotice(`User ${target.email} updated.`);
      load();
    } catch (err) {
      setActionError(err);
    }
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <div className="card">
          <h2>Users</h2>
          <ErrorAlert error={new ApiError(403, 'FORBIDDEN', 'Only administrators can manage users.')} />
          <p className="muted">Signed in as {me?.email ?? '…'} ({me?.role}).</p>
        </div>
      );
    }
    return <ErrorAlert error={error} />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Administration</h1>
          <p>Roles are checked on the API, never in the browser. Self-demotion and self-deactivation are refused server-side.</p>
        </div>
      </div>

      <OkAlert>{notice}</OkAlert>
      <ErrorAlert error={actionError} />

      <div className="card">
        {!users && !error && <Loading />}
        {users && (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((entry) => {
                const isSelf = entry.id === me?.id;
                return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.name}</strong>
                      {isSelf && <span className="muted"> (you)</span>}
                    </td>
                    <td>{entry.email}</td>
                    <td>
                      {isSelf ? (
                        <Badge value={entry.role} />
                      ) : (
                        <select
                          value={entry.role}
                          onChange={(e) => update(entry, { role: e.target.value as Role })}
                          style={{ width: 110 }}
                        >
                          <option value="STAFF">STAFF</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {isSelf ? (
                        <Badge value={entry.isActive ? 'OPEN' : 'CLOSED'} />
                      ) : (
                        <button
                          type="button"
                          className={`btn btn-sm${entry.isActive ? ' btn-danger' : ''}`}
                          onClick={() => update(entry, { isActive: !entry.isActive })}
                        >
                          {entry.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                    <td>{formatDate(entry.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
