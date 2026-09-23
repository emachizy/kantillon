import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPendingReceipts, approveReceipt, rejectReceipt } from '../api/stockReceipts.js';
import {
  fetchPendingCorrectionRequests,
  approveCorrectionRequest,
  rejectCorrectionRequest,
} from '../api/corrections.js';
import { formatKoboAsNaira } from '../utils/money.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

export function PendingApprovalsPage() {
  const queryClient = useQueryClient();
  const pendingQuery = useQuery({ queryKey: ['stockReceipts', 'pending'], queryFn: fetchPendingReceipts });
  const pendingCorrectionsQuery = useQuery({
    queryKey: ['correctionRequests', 'pending'],
    queryFn: fetchPendingCorrectionRequests,
  });
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [rejectingCorrectionId, setRejectingCorrectionId] = useState(null);
  const [correctionReason, setCorrectionReason] = useState('');

  function invalidateAffectedQueries() {
    queryClient.invalidateQueries({ queryKey: ['stockReceipts'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }

  function invalidateCorrectionQueries() {
    queryClient.invalidateQueries({ queryKey: ['correctionRequests'] });
    queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
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

  const approveCorrectionMutation = useMutation({
    mutationFn: approveCorrectionRequest,
    onSuccess: invalidateCorrectionQueries,
  });

  const rejectCorrectionMutation = useMutation({
    mutationFn: ({ id, reason: rejectReason }) => rejectCorrectionRequest(id, rejectReason),
    onSuccess: () => {
      invalidateCorrectionQueries();
      setRejectingCorrectionId(null);
      setCorrectionReason('');
    },
  });

  const receipts = pendingQuery.data || [];
  const correctionRequests = pendingCorrectionsQuery.data || [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-slate-900">Pending stock approvals</h1>

        {pendingQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
        {pendingQuery.isError && <p className="text-sm text-red-600">Failed to load pending approvals.</p>}
        {!pendingQuery.isLoading && !pendingQuery.isError && receipts.length === 0 && (
          <p className="text-sm text-slate-500">Nothing waiting on you.</p>
        )}

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

      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-slate-900">Pending report corrections</h1>

        {pendingCorrectionsQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
        {pendingCorrectionsQuery.isError && (
          <p className="text-sm text-red-600">Failed to load pending corrections.</p>
        )}
        {!pendingCorrectionsQuery.isLoading && !pendingCorrectionsQuery.isError && correctionRequests.length === 0 && (
          <p className="text-sm text-slate-500">No correction requests waiting on you.</p>
        )}

        {(approveCorrectionMutation.isError || rejectCorrectionMutation.isError) && (
          <p className="text-sm text-red-600">
            {errorMessage(approveCorrectionMutation.error || rejectCorrectionMutation.error, 'That action failed.')}
          </p>
        )}

        {correctionRequests.map((req) => {
          const proposedTotal = req.proposedSalesLines.reduce((sum, l) => sum + l.quantity, 0);
          return (
            <div key={req._id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{req.shopId?.name}</span>
                <span className="text-xs text-slate-400">{req.businessDate}</span>
              </div>
              <p className="text-xs text-slate-500">{req.productId?.name}</p>
              <p className="text-xs text-slate-400">
                Requested by {req.requestedBy?.name} · Reason: {req.reason}
              </p>
              <p className="text-sm text-slate-700">Proposed bags sold: {proposedTotal}</p>
              <p className="text-sm text-slate-700">
                Proposed physical closing: {req.proposedPhysicalClosingStockQuantity}
              </p>
              <p className="text-sm text-slate-700">
                Proposed amount collected: {formatKoboAsNaira(req.proposedActualAmountCollectedKobo)}
              </p>
              <Link
                to={`/daily-reports/${req.dailySalesReportId}`}
                className="block text-xs text-slate-500 underline"
              >
                View current report
              </Link>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={approveCorrectionMutation.isPending}
                  onClick={() => approveCorrectionMutation.mutate(req._id)}
                  className="flex-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectingCorrectionId(req._id);
                    setCorrectionReason('');
                  }}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                >
                  Reject
                </button>
              </div>

              {rejectingCorrectionId === req._id && (
                <div className="space-y-2 border-t border-slate-100 pt-2">
                  <input
                    type="text"
                    placeholder="Reason for rejection"
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!correctionReason.trim() || rejectCorrectionMutation.isPending}
                      onClick={() =>
                        rejectCorrectionMutation.mutate({ id: req._id, reason: correctionReason })
                      }
                      className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {rejectCorrectionMutation.isPending ? 'Rejecting...' : 'Confirm reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingCorrectionId(null)}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
