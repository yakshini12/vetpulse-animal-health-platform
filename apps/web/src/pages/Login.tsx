import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Field } from '../components/ui.js';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>VetPulse</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Animal-health case management and diagnostic sample tracking.
        </p>
        <form onSubmit={onSubmit}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="demo">
          <strong>Demo accounts (seeded synthetic data):</strong>
          <br />
          admin@vetpulse.dev / VetPulse!2026
          <br />
          priya.sharma@vetpulse.dev / VetPulse!2026
        </div>
      </div>
    </div>
  );
}
