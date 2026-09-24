import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const navLinkClass = ({ isActive }) =>
  `flex-1 py-2 text-center text-sm font-medium ${isActive ? 'text-slate-900' : 'text-slate-400'}`;

// Mobile-first shell: a slim top bar, content area, and a bottom tab bar —
// enough navigation to operate Phase 2's workflow, not the final dashboard.
export function AppShell() {
  const { user, logout } = useAuth();
  const isOwner = user?.role === 'OWNER';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <span className="text-base font-semibold text-slate-900">Kantillon</span>
        <button
          type="button"
          onClick={() => logout()}
          className="text-sm font-medium text-slate-500"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 px-4 py-4 pb-20">
        <Outlet context={{ user }} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-slate-200 bg-white">
        <NavLink to="/" end className={navLinkClass}>
          Home
        </NavLink>
        {isOwner && (
          <NavLink to="/approvals" className={navLinkClass}>
            Approvals
          </NavLink>
        )}
        {isOwner && (
          <NavLink to="/daily-summary" className={navLinkClass}>
            Daily Summary
          </NavLink>
        )}
        {isOwner && (
          <NavLink to="/shops/manage" className={navLinkClass}>
            Shops
          </NavLink>
        )}
        {isOwner && (
          <NavLink to="/users" className={navLinkClass}>
            Users
          </NavLink>
        )}
        <NavLink to="/receipts" className={navLinkClass}>
          History
        </NavLink>
      </nav>
    </div>
  );
}
