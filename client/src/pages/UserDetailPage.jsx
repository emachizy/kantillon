import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import {
  fetchUserById,
  updateUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
} from '../api/users.js';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

const ROLE_OPTIONS = [
  { value: 'SALESPERSON', label: 'Salesperson' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

export function UserDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const userQuery = useQuery({ queryKey: ['users', id], queryFn: () => fetchUserById(id) });
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: fetchShops });

  const [role, setRole] = useState('');
  const [shopIds, setShopIds] = useState([]);
  const [newTemporaryPassword, setNewTemporaryPassword] = useState('');
  const [resetPasswordResult, setResetPasswordResult] = useState(null);

  useEffect(() => {
    if (userQuery.data) {
      setRole(userQuery.data.role);
      setShopIds((userQuery.data.shopIds || []).map((shop) => shop._id));
    }
  }, [userQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users', id] });
  }

  const updateMutation = useMutation({ mutationFn: updateUser, onSuccess: invalidate });
  const deactivateMutation = useMutation({ mutationFn: deactivateUser, onSuccess: invalidate });
  const reactivateMutation = useMutation({ mutationFn: reactivateUser, onSuccess: invalidate });
  const resetPasswordMutation = useMutation({
    mutationFn: resetUserPassword,
    onSuccess: () => {
      invalidate();
      setResetPasswordResult(newTemporaryPassword);
      setNewTemporaryPassword('');
    },
  });

  function toggleShop(shopId) {
    setShopIds((prev) => (prev.includes(shopId) ? prev.filter((sid) => sid !== shopId) : [...prev, shopId]));
  }

  if (userQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading user...</p>;
  }
  if (userQuery.isError) {
    const status = userQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403 ? 'You do not have access to this page.' : 'Failed to load user.'}
      </p>
    );
  }

  const user = userQuery.data;
  const isOwnerAccount = user.role === 'OWNER';

  return (
    <div className="space-y-4">
      <Link to="/users" className="inline-block text-sm text-slate-500">
        ← Users &amp; Staff
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-slate-900">{user.name}</h1>
        <p className="text-xs text-slate-400">{user.email}</p>
      </div>

      {isOwnerAccount ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm text-slate-600">
            This is the OWNER account. It cannot be edited, deactivated, or have its role changed from here.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                user.isActive
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-slate-200 bg-slate-100 text-slate-500'
              }`}
            >
              {user.isActive ? 'Active' : 'Inactive'}
            </span>
            <button
              type="button"
              disabled={deactivateMutation.isPending || reactivateMutation.isPending}
              onClick={() => (user.isActive ? deactivateMutation.mutate(id) : reactivateMutation.mutate(id))}
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
            <div>
              <label htmlFor="role" className="mb-1 block text-sm font-medium text-slate-700">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Assigned Shops</p>
              <div className="space-y-1 rounded-md border border-slate-200 p-2">
                {(shopsQuery.data || []).map((shop) => (
                  <label key={shop._id} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={shopIds.includes(shop._id)}
                      onChange={() => toggleShop(shop._id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {shop.name}
                  </label>
                ))}
                {shopsQuery.isSuccess && shopsQuery.data.length === 0 && (
                  <div className="space-y-1 py-1 text-xs text-slate-400">
                    <p>No shops have been created yet.</p>
                    <Link to="/shops/manage/new" className="inline-block font-medium text-slate-600 underline">
                      Create Shop
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {updateMutation.isError && (
              <p className="text-xs text-red-600">{errorMessage(updateMutation.error, 'Could not save changes.')}</p>
            )}
            {updateMutation.isSuccess && <p className="text-xs text-green-700">Saved.</p>}

            <button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ id, role, shopIds })}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save changes'}
            </button>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-700">Reset password</p>
            {resetPasswordResult ? (
              <div className="rounded-md border border-green-200 bg-green-50 p-2">
                <p className="text-xs text-green-800">
                  Password reset. Share this temporary password securely — it will not be shown again.
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">{resetPasswordResult}</p>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="New temporary password"
                  minLength={8}
                  value={newTemporaryPassword}
                  onChange={(e) => setNewTemporaryPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                {resetPasswordMutation.isError && (
                  <p className="text-xs text-red-600">
                    {errorMessage(resetPasswordMutation.error, 'Could not reset password.')}
                  </p>
                )}
                <button
                  type="button"
                  disabled={resetPasswordMutation.isPending || newTemporaryPassword.length < 8}
                  onClick={() => resetPasswordMutation.mutate({ id, newTemporaryPassword })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                >
                  {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset password'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
