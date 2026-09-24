import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Nested inside ProtectedRoute (so auth/mustChangePassword are already
// handled) — this only adds the OWNER check for OWNER-management pages
// (Users & Staff, Shop management). This is a UX guard only: every
// underlying API route re-enforces requireRole(OWNER) server-side
// regardless of what this component does.
export function OwnerRoute() {
  const { user } = useAuth();
  if (user?.role !== 'OWNER') {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
