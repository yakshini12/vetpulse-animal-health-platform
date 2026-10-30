import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client.js';
import type { DashboardSummary } from '../api/types.js';
import { ErrorAlert, Loading } from '../components/ui.js';
import { formatDate, humanize } from '../lib/format.js';

const PURPLE = '#7c3aed';
const CASE_COLORS: Record<string, string> = {
  OPEN: '#0d9488',
  IN_PROGRESS: '#2563eb',
  RESOLVED: '#65a30d',
  CLOSED: '#94a3b8',
};
const SAMPLE_COLORS: Record<string, string> = {
  RECEIVED: '#2563eb',
  IN_PROCESS: '#7c3aed',
  IN_REVIEW: '#d97706',
  COMPLETED: '#15803d',
  REJECTED: '#b91c1c',
};

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<DashboardSummary>('/api/dashboard/summary')
      .then(setSummary)
      .catch(setError);
  }, []);

  if (error && !summary) return <ErrorAlert error={error} />;
  if (!summary) return <Loading />;

  const invalidPct = summary.samples.total > 0 ? Math.round((summary.samples.invalidMetadata / summary.samples.total) * 100) : 0;
  const caseStatusData = Object.entries(summary.cases.byStatus).map(([status, count]) => ({ status, count }));
  const sampleStatusData = Object.entries(summary.samples.byStatus).map(([status, count]) => ({ status, count }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Operations Dashboard</h1>
          <p>Live figures from the database — nothing cached, nothing mocked.</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="muted">Active cases</div>
          <div className="value">{summary.cases.total}</div>
          <div className="sub">all case records</div>
        </div>
        <div className="kpi">
          <div className="muted">Awaiting processing</div>
          <div className="value">{summary.samples.awaitingProcessing}</div>
          <div className="sub">samples still RECEIVED</div>
        </div>
        <div className="kpi">
          <div className="muted">Open tasks</div>
          <div className="value">{summary.openTasks}</div>
          <div className="sub">TODO or in progress</div>
        </div>
        <div className="kpi">
          <div className="muted">Avg turnaround</div>
          <div className="value">{summary.avgTurnaroundHours ?? '—'}</div>
          <div className="sub">
            hours over {summary.completedSamplesWithTurnaround} completed sample{summary.completedSamplesWithTurnaround === 1 ? '' : 's'}
          </div>
        </div>
        <div className="kpi flag">
          <div className="muted">Invalid sample metadata</div>
          <div className="value">{summary.samples.invalidMetadata}</div>
          <div className="sub">{invalidPct}% of all samples fail quality rules</div>
        </div>
      </div>

      <div className="charts">
        <div className="card">
          <h2>Case volume — last 30 days</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={summary.caseVolume} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(day: string) => day.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" name="Cases created" stroke="#0f766e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h2>Sample pipeline</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sampleStatusData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} tickFormatter={(v: string) => humanize(v)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" name="Samples">
                {sampleStatusData.map((entry) => (
                  <Cell key={entry.status} fill={SAMPLE_COLORS[entry.status] ?? PURPLE} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="charts" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Team workload (open items)</h2>
          {summary.workload.length === 0 ? (
            <p className="empty">No active staff.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={summary.workload} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="openTasks" name="Open tasks" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} />
                <Bar dataKey="openCases" name="Open cases" stackId="a" fill="#0d9488" />
                <Bar dataKey="activeSamples" name="Active samples" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="card">
          <h2>Case status mix</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={caseStatusData} dataKey="count" nameKey="status" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {caseStatusData.map((entry) => (
                  <Cell key={entry.status} fill={CASE_COLORS[entry.status] ?? PURPLE} />
                ))}
              </Pie>
              <Tooltip />
              <Legend formatter={(value: string) => humanize(value)} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Tasks due soon (next 3 days)</h2>
          {summary.dueSoonTasks.length === 0 ? (
            <p className="empty">Nothing due within three days.</p>
          ) : (
            <ul className="activity">
              {summary.dueSoonTasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <div>
                    <span className="when">due {formatDate(task.dueDate)}</span>
                    {task.assignee && <span className="when"> · {task.assignee}</span>}
                    {task.caseNumber && (
                      <>
                        {' · '}
                        <span className="mono">{task.caseNumber}</span>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link to="/tasks">View all tasks →</Link>
        </div>
        <div className="card">
          <h2>Recent activity</h2>
          {summary.recentActivity.length === 0 ? (
            <p className="empty">No recorded events yet.</p>
          ) : (
            <ul className="activity">
              {summary.recentActivity.map((event) => (
                <li key={event.id}>
                  {event.summary}
                  <div className="when">
                    <strong>{humanize(event.eventType)}</strong> · {event.actorName} · {formatDate(event.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
