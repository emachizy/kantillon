import { useQuery } from '@tanstack/react-query';
import { fetchReceiptHistory } from '../api/stockReceipts.js';

const STATUS_STYLES = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-green-50 text-green-700 border-green-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

// Authorization/filtering (all shops for OWNER, only assigned shops for
// everyone else) is enforced server-side — this page just renders whatever
// GET /api/stock-receipts returns for the current user.
export function ReceiptHistoryPage() {
  const historyQuery = useQuery({
    queryKey: ['stockReceipts', 'history'],
    queryFn: () => fetchReceiptHistory(),
  });

  if (historyQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading receipt history...</p>;
  }
  if (historyQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load receipt history.</p>;
  }

  const receipts = historyQuery.data || [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-900">Stock receipt history</h1>

      {receipts.length === 0 && <p className="text-sm text-slate-500">No stock receipts yet.</p>}

      {receipts.map((receipt) => (
        <div key={receipt._id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900">{receipt.shopId?.name}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[receipt.status]}`}
            >
              {receipt.status}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {receipt.productId?.name} · {receipt.quantity} {receipt.productId?.unit}
          </p>
          <p className="text-xs text-slate-400">
            Reported by {receipt.receivedBy?.name} · {new Date(receipt.receivedAt).toLocaleString()}
          </p>
          {receipt.status === 'REJECTED' && receipt.rejectionReason && (
            <p className="text-xs text-red-600">Reason: {receipt.rejectionReason}</p>
          )}
        </div>
      ))}
    </div>
  );
}
