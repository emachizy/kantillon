import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import { createUser } from '../api/users.js';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

// OWNER can never assign the OWNER role through this form — see
// server/src/utils/constants.js ASSIGNABLE_STAFF_ROLES, which the backend
// enforces regardless of what this list contains.
const ROLE_OPTIONS = [
  { value: 'SALESPERSON', label: 'Salesperson' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

export function AddUserPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: fetchShops });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('SALESPERSON');
  const [shopIds, setShopIds] = useState([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [created, setCreated] = useState(null);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // The temporary password is shown ONLY from what was just submitted
      // in this form — it is never fetched back from the API afterward.
      setCreated({ email: user.email, temporaryPassword });
    },
  });

  function toggleShop(shopId) {
    setShopIds((prev) => (prev.includes(shopId) ? prev.filter((id) => id !== shopId) : [...prev, shopId]));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (temporaryPassword !== confirmPassword) {
      setConfirmMismatch(true);
      return;
    }
    setConfirmMismatch(false);
    createMutation.mutate({ name, email, role, shopIds, temporaryPassword });
  }

  if (created) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">User created</h1>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">
            User created successfully. Share the temporary login details securely with the staff member.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-slate-900">{created.email}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Temporary password</dt>
              <dd className="font-medium text-slate-900">{created.temporaryPassword}</dd>
            </div>
          </dl>
        </div>
        <div className="flex gap-2">
          <Link
            to="/users"
            className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white"
          >
            Back to Users &amp; Staff
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setName('');
              setEmail('');
              setRole('SALESPERSON');
              setShopIds([]);
              setTemporaryPassword('');
              setConfirmPassword('');
            }}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link to="/users" className="inline-block text-sm text-slate-500">
        ← Users &amp; Staff
      </Link>
      <h1 className="text-lg font-semibold text-slate-900">Add User</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Full Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

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
          <p className="mb-1 text-sm font-medium text-slate-700">Assigned Shop(s)</p>
          {shopsQuery.isLoading && <p className="text-xs text-slate-500">Loading shops...</p>}
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
              <div className="space-y-1 text-xs text-slate-400">
                <p>No shops yet — create a shop first, or assign later.</p>
                <Link to="/shops/manage/new" className="inline-block font-medium text-slate-600 underline">
                  Create Shop
                </Link>
              </div>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="temporaryPassword" className="mb-1 block text-sm font-medium text-slate-700">
            Temporary Password
          </label>
          <input
            id="temporaryPassword"
            type="text"
            required
            minLength={8}
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
            Confirm Temporary Password
          </label>
          <input
            id="confirmPassword"
            type="text"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {confirmMismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>}
        </div>

        {createMutation.isError && (
          <p className="text-sm text-red-600">
            {errorMessage(createMutation.error, 'Could not create user.')}
          </p>
        )}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating...' : 'Create User'}
        </button>
      </form>
    </div>
  );
}
