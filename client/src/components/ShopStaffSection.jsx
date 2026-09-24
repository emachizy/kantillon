import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchShopStaff, fetchUsers, updateUser } from '../api/users.js';

const ROLE_LABELS = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALESPERSON: 'Salesperson',
};

// OWNER-only (every render site only mounts this for isOwner). Reuses the
// same PATCH /api/users/:id endpoint the Users & Staff pages use to assign
// shops, rather than a second assignment system: assigning here just adds
// this shop to the picked user's existing shopIds. Shared between the
// operational ShopInventoryPage and the OWNER's ManageShopPage so there is
// exactly one staff-assignment UI, not two.
export function ShopStaffSection({ shopId }) {
  const queryClient = useQueryClient();
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const staffQuery = useQuery({ queryKey: ['shops', shopId, 'staff'], queryFn: () => fetchShopStaff(shopId) });
  const allUsersQuery = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers(), enabled: isAssigning });

  const assignMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shops', shopId, 'staff'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsAssigning(false);
      setSelectedUserId('');
    },
  });

  const assignedIds = new Set((staffQuery.data || []).map((u) => u._id));
  const assignableUsers = (allUsersQuery.data || []).filter(
    (u) => u.role !== 'OWNER' && !assignedIds.has(u._id)
  );

  function handleAssign() {
    const target = (allUsersQuery.data || []).find((u) => u._id === selectedUserId);
    if (!target) return;
    const nextShopIds = [...new Set([...(target.shopIds || []).map((s) => s._id), shopId])];
    assignMutation.mutate({ id: selectedUserId, shopIds: nextShopIds });
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Staff</h2>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        {staffQuery.isLoading && <p className="text-sm text-slate-500">Loading staff...</p>}
        {staffQuery.isSuccess && staffQuery.data.length === 0 && (
          <p className="text-sm text-slate-500">No staff assigned to this shop yet.</p>
        )}
        {(staffQuery.data || []).map((member) => (
          <div key={member._id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
            <div>
              <p className="text-sm font-medium text-slate-900">{member.name}</p>
              <p className="text-xs text-slate-500">
                {ROLE_LABELS[member.role] || member.role}
                {!member.isActive && ' · Inactive'}
              </p>
            </div>
            <Link to={`/users/${member._id}`} className="text-xs font-medium text-slate-500">
              Manage
            </Link>
          </div>
        ))}

        {isAssigning ? (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            {allUsersQuery.isLoading && <p className="text-xs text-slate-500">Loading users...</p>}
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select a user...</option>
              {assignableUsers.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} ({ROLE_LABELS[u.role] || u.role})
                </option>
              ))}
            </select>
            {assignMutation.isError && (
              <p className="text-xs text-red-600">Could not assign staff. Please try again.</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!selectedUserId || assignMutation.isPending}
                onClick={handleAssign}
                className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {assignMutation.isPending ? 'Assigning...' : 'Assign'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAssigning(false);
                  setSelectedUserId('');
                }}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAssigning(true)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            + Assign Staff
          </button>
        )}
      </div>
    </div>
  );
}
