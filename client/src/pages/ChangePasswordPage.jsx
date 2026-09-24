import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { changePasswordRequest } from '../api/auth.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

// Shown when the logged-in user's account has mustChangePassword set (new
// staff accounts, or after an OWNER-issued password reset) — see
// ProtectedRoute.jsx for the redirect that gets a user here.
export function ChangePasswordPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const mutation = useMutation({
    mutationFn: changePasswordRequest,
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['auth', 'me'], updatedUser);
    },
  });

  if (!user?.mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    mutation.mutate({ currentPassword, newPassword });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Choose a new password</h1>
        <p className="mb-6 text-sm text-slate-500">
          Your account was created with a temporary password. Set your own before continuing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium text-slate-700">
              Current temporary password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-slate-700">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-base"
            />
            {mismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>}
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">{errorMessage(mutation.error, 'Could not change password.')}</p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-base font-medium text-white disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
