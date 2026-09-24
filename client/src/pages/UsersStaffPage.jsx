import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchUsers } from '../api/users.js';

const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALESPERSON: 'Salesperson',
};

export function UsersStaffPage() {
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers() });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Users &amp; Staff</h1>
        <Link
          to="/users/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          + Add User
        </Link>
      </div>

      {usersQuery.isLoading && <p className="text-sm text-slate-500">Loading users...</p>}
      {usersQuery.isError && <p className="text-sm text-red-600">Failed to load users.</p>}

      {usersQuery.isSuccess && usersQuery.data.length === 0 && (
        <p className="text-sm text-slate-500">No staff accounts yet. Add your first one above.</p>
      )}

      <div className="space-y-2">
        {(usersQuery.data || []).map((user) => (
          <Link
            key={user._id}
            to={`/users/${user._id}`}
            className="block rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[user.role] || user.role}</p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  user.isActive
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-slate-200 bg-slate-100 text-slate-500'
                }`}
              >
                {user.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            {user.role !== 'OWNER' && (
              <p className="mt-1 text-xs text-slate-500">
                {user.shopIds?.length
                  ? user.shopIds.map((shop) => shop.name).join(', ')
                  : 'No shops assigned yet'}
              </p>
            )}

            <span className="mt-2 block text-xs font-medium text-slate-500">Manage →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
