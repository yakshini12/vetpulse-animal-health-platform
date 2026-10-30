import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { Loading } from './components/ui.js';
import { Layout } from './components/Layout.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { Cases } from './pages/Cases.js';
import { CaseDetail } from './pages/CaseDetail.js';
import { Samples } from './pages/Samples.js';
import { SampleDetail } from './pages/SampleDetail.js';
import { Tasks } from './pages/Tasks.js';
import { Imports } from './pages/Imports.js';
import { Audit } from './pages/Audit.js';
import { Users } from './pages/Users.js';

export function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    document.title = user ? `VetPulse — ${user.name}` : 'VetPulse';
  }, [user]);

  if (loading) {
    return (
      <div className="login-wrap">
        <Loading label="Restoring session…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/samples" element={<Samples />} />
        <Route path="/samples/:id" element={<SampleDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/imports" element={<Imports />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/users" element={<Users />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
