import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { Badge } from './ui.js';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/cases', label: 'Cases' },
  { to: '/samples', label: 'Samples' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/imports', label: 'Data Imports' },
  { to: '/audit', label: 'Audit Trail' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          VetPulse
          <small>Animal Health Ops</small>
        </div>
        <nav>
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              {link.label}
            </NavLink>
          ))}
          {user?.role === 'ADMIN' && (
            <NavLink to="/users" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              Users
            </NavLink>
          )}
        </nav>
        <div className="side-foot">
          Synthetic demo data only.
          <br />
          No real animals or farms.
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div />
          <div className="topbar-user">
            {user && (
              <>
                <strong>{user.name}</strong>
                <Badge value={user.role} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
