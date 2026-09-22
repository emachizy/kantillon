import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPendingReceipts, approveReceipt, rejectReceipt } from '../api/stockReceipts.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

export function PendingApprovalsPage() {
  const queryClient = useQueryClient();
  const pendingQuery = useQuery({ queryKey: ['stockReceipts', 'pending'], queryFn: fetchPendingReceipts });
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');

  function invalidateAffectedQueries() {
    queryClient.invalidateQueries({ queryKey: ['stockReceipts'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }

  const approveMutation = useMutation({
    mutationFn: approveReceipt,
    onSuccess: invalidateAffectedQueries,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason: rejectReason }) => rejectReceipt(id, rejectReason),
    onSuccess: () => {
      invalidateAffectedQueries();
      setRejectingId(null);
      setReason('');
    },
  });

  if (pendingQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading pending approvals...</p>;
  }
  if (pendingQuery.isError) {
    const status = pendingQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403
          ? 'Only the owner can review stock approvals.'
          : 'Failed to load pending approvals.'}
      </p>
    );
  }

  const receipts = pendingQuery.data || [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">Pending stock approvals</h1>

      {receipts.length === 0 && <p className="text-sm text-slate-500">Nothing waiting on you.</p>}

      {(approveMutation.isError || rejectMutation.isError) && (
        <p className="text-sm text-red-600">
          {errorMessage(approveMutation.error || rejectMutation.error, 'That action failed.')}
        </p>
      )}

      {receipts.map((receipt) => (
        <div key={receipt._id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900">{receipt.shopId?.name}</span>
            <span className="text-sm text-slate-700">
              {receipt.quantity} {receipt.productId?.unit}
            </span>
          </div>
          <p className="text-xs text-slate-500">{receipt.productId?.name}</p>
          <p className="text-xs text-slate-400">
            Reported by {receipt.receivedBy?.name} · {new Date(receipt.receivedAt).toLocaleString()}
          </p>
          {receipt.deliveryReference && (
            <p className="text-xs text-slate-400">Ref: {receipt.deliveryReference}</p>
          )}
          {receipt.notes && <p className="text-xs text-slate-400">Notes: {receipt.notes}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate(receipt._id)}
              className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectingId(receipt._id);
                setReason('');
              }}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Reject
            </button>
          </div>

          {rejectingId === receipt._id && (
            <div className="space-y-2 border-t border-slate-100 pt-2">
              <input
                type="text"
                placeholder="Reason for rejection"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!reason.trim() || rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate({ id: receipt._id, reason })}
                  className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {rejectMutation.isPending ? 'Rejecting...' : 'Confirm reject'}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectingId(null)}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
