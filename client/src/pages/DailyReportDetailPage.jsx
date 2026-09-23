import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchEffectiveReport } from '../api/corrections.js';
import {
  createStockVarianceResolution,
  fetchStockVarianceResolutions,
  reverseStockVarianceResolution,
  createMoneyVarianceResolution,
  fetchMoneyVarianceResolutions,
  reverseMoneyVarianceResolution,
} from '../api/varianceResolutions.js';
import { formatKoboAsNaira, nairaInputToKobo } from '../utils/money.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function ReverseControl({ onConfirm, isPending }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-slate-500 underline">
        Reverse
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="text"
        placeholder="Reversal reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <button
        type="button"
        disabled={!reason.trim() || isPending}
        onClick={() => {
          onConfirm(reason);
          setOpen(false);
          setReason('');
        }}
        className="text-red-600 underline disabled:opacity-50"
      >
        Confirm
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-slate-400 underline">
        Cancel
      </button>
    </span>
  );
}

function stockStatusLabel(variance) {
  if (variance === 0) return 'BALANCED';
  return variance < 0 ? 'SHORTAGE' : 'SURPLUS';
}

function moneyStatusLabel(varianceKobo) {
  if (varianceKobo === 0) return 'BALANCED';
  return varianceKobo < 0 ? 'MONEY SHORT' : 'MONEY SURPLUS';
}

function StockResolveForm({ unresolved, onSubmit, isPending, error }) {
  const [resolutionType, setResolutionType] = useState(unresolved < 0 ? 'DAMAGE' : 'SURPLUS');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const options = unresolved < 0 ? ['DAMAGE', 'SHORTAGE'] : ['SURPLUS'];

  function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    onSubmit({ resolutionType, quantity: parsed, reason, notes: notes || undefined });
    setQuantity('');
    setReason('');
    setNotes('');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-100 pt-2">
      <select
        value={resolutionType}
        onChange={(e) => setResolutionType(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="1"
        step="1"
        placeholder="Quantity (bags)"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{errorMessage(error, 'Could not resolve stock variance.')}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Saving...' : 'Resolve Stock Variance'}
      </button>
    </form>
  );
}

function MoneyResolveForm({ unresolved, onSubmit, isPending, error }) {
  const shortOptions = ['RECOVERED', 'ACCEPTED_SHORTAGE', 'EXPLAINED'];
  const excessOptions = ['EXCESS_CONFIRMED', 'REFUNDED', 'EXPLAINED'];
  const options = unresolved < 0 ? shortOptions : excessOptions;

  const [resolutionType, setResolutionType] = useState(options[0]);
  const [amountNaira, setAmountNaira] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    let amountKobo;
    try {
      amountKobo = nairaInputToKobo(amountNaira);
    } catch {
      return;
    }
    if (amountKobo <= 0) return;
    onSubmit({ resolutionType, amountKobo, reason, notes: notes || undefined });
    setAmountNaira('');
    setReason('');
    setNotes('');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-100 pt-2">
      <select
        value={resolutionType}
        onChange={(e) => setResolutionType(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="Amount (₦)"
        value={amountNaira}
        onChange={(e) => setAmountNaira(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{errorMessage(error, 'Could not resolve money variance.')}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Saving...' : 'Resolve Money Variance'}
      </button>
    </form>
  );
}

export function DailyReportDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [showStockForm, setShowStockForm] = useState(false);
  const [showMoneyForm, setShowMoneyForm] = useState(false);

  const effectiveQuery = useQuery({
    queryKey: ['dailyReports', 'effective', id],
    queryFn: () => fetchEffectiveReport(id),
  });
  const stockResolutionsQuery = useQuery({
    queryKey: ['stockVarianceResolutions', id],
    queryFn: () => fetchStockVarianceResolutions(id),
    enabled: Boolean(effectiveQuery.data),
  });
  const moneyResolutionsQuery = useQuery({
    queryKey: ['moneyVarianceResolutions', id],
    queryFn: () => fetchMoneyVarianceResolutions(id),
    enabled: Boolean(effectiveQuery.data),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
    queryClient.invalidateQueries({ queryKey: ['stockVarianceResolutions', id] });
    queryClient.invalidateQueries({ queryKey: ['moneyVarianceResolutions', id] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }

  const resolveStockMutation = useMutation({
    mutationFn: (payload) => createStockVarianceResolution(id, payload),
    onSuccess: () => {
      invalidateAll();
      setShowStockForm(false);
    },
  });
  const reverseStockMutation = useMutation({
    mutationFn: ({ resolutionId, reason }) => reverseStockVarianceResolution(resolutionId, reason),
    onSuccess: invalidateAll,
  });
  const resolveMoneyMutation = useMutation({
    mutationFn: (payload) => createMoneyVarianceResolution(id, payload),
    onSuccess: () => {
      invalidateAll();
      setShowMoneyForm(false);
    },
  });
  const reverseMoneyMutation = useMutation({
    mutationFn: ({ resolutionId, reason }) => reverseMoneyVarianceResolution(resolutionId, reason),
    onSuccess: invalidateAll,
  });

  if (effectiveQuery.isLoading) return <p className="text-sm text-slate-500">Loading report...</p>;
  if (effectiveQuery.isError) {
    const status = effectiveQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403 ? 'You do not have access to this report.' : 'Failed to load report.'}
      </p>
    );
  }

  const { original, effective, isCorrected, corrections, unresolvedStockVarianceQuantity, unresolvedMoneyVarianceKobo } =
    effectiveQuery.data;

  const hasActiveResolution =
    stockResolutionsQuery.data?.some((r) => r.status === 'ACTIVE') ||
    moneyResolutionsQuery.data?.some((r) => r.status === 'ACTIVE');
  const canRequestCorrection = !hasActiveResolution;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {original.shopId?.name} — {original.businessDate}
          </h1>
          <p className="text-sm text-slate-500">{original.productId?.name}</p>
        </div>
        {isCorrected && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Corrected
          </span>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Sales lines {isCorrected && '(effective)'}</h2>
        {effective.salesLines.map((line, i) => (
          <p key={i} className="text-sm text-slate-700">
            {line.quantity} bags @ {formatKoboAsNaira(line.unitPriceKobo)} = {formatKoboAsNaira(line.lineRevenueKobo)}
          </p>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Stock reconciliation</h2>
        <Row label="Opening stock" value={original.openingStockQuantity} />
        <Row label="Available stock" value={original.availableStockQuantity} />
        <Row label="Bags sold" value={effective.totalQuantitySold} />
        <Row label="Expected closing" value={effective.expectedClosingStockQuantity} />
        <Row label="Physical closing" value={effective.physicalClosingStockQuantity} />
        <Row
          label="Variance"
          value={`${effective.stockVarianceQuantity} (${stockStatusLabel(effective.stockVarianceQuantity)})`}
        />
        <Row label="Resolved" value={effective.stockVarianceQuantity - unresolvedStockVarianceQuantity} />
        <Row
          label="Remaining"
          value={`${unresolvedStockVarianceQuantity} (${stockStatusLabel(unresolvedStockVarianceQuantity)})`}
        />

        {isOwner && unresolvedStockVarianceQuantity !== 0 && !showStockForm && (
          <button
            type="button"
            onClick={() => setShowStockForm(true)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            Resolve Stock Variance
          </button>
        )}
        {isOwner && showStockForm && (
          <StockResolveForm
            unresolved={unresolvedStockVarianceQuantity}
            isPending={resolveStockMutation.isPending}
            error={resolveStockMutation.error}
            onSubmit={(payload) => resolveStockMutation.mutate(payload)}
          />
        )}

        {stockResolutionsQuery.data?.length > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <p className="text-xs font-medium text-slate-600">Resolution history</p>
            {stockResolutionsQuery.data.map((r) => (
              <div key={r._id} className="flex items-center justify-between text-xs">
                <span className={r.status === 'REVERSED' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                  {r.resolutionType} {r.quantity} — {r.reason}
                </span>
                {isOwner && r.status === 'ACTIVE' && (
                  <ReverseControl
                    isPending={reverseStockMutation.isPending}
                    onConfirm={(reason) => reverseStockMutation.mutate({ resolutionId: r._id, reason })}
                  />
                )}
                {r.status === 'REVERSED' && <span className="text-slate-400">reversed</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Money reconciliation</h2>
        <Row label="Expected revenue" value={formatKoboAsNaira(effective.expectedRevenueKobo)} />
        <Row label="Amount collected" value={formatKoboAsNaira(effective.actualAmountCollectedKobo)} />
        <Row
          label="Variance"
          value={`${formatKoboAsNaira(effective.moneyVarianceKobo)} (${moneyStatusLabel(effective.moneyVarianceKobo)})`}
        />
        <Row
          label="Remaining"
          value={`${formatKoboAsNaira(unresolvedMoneyVarianceKobo)} (${moneyStatusLabel(unresolvedMoneyVarianceKobo)})`}
        />

        {isOwner && unresolvedMoneyVarianceKobo !== 0 && !showMoneyForm && (
          <button
            type="button"
            onClick={() => setShowMoneyForm(true)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            Resolve Money Variance
          </button>
        )}
        {isOwner && showMoneyForm && (
          <MoneyResolveForm
            unresolved={unresolvedMoneyVarianceKobo}
            isPending={resolveMoneyMutation.isPending}
            error={resolveMoneyMutation.error}
            onSubmit={(payload) => resolveMoneyMutation.mutate(payload)}
          />
        )}

        {moneyResolutionsQuery.data?.length > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <p className="text-xs font-medium text-slate-600">Resolution history</p>
            {moneyResolutionsQuery.data.map((r) => (
              <div key={r._id} className="flex items-center justify-between text-xs">
                <span className={r.status === 'REVERSED' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                  {r.resolutionType} {formatKoboAsNaira(r.amountKobo)} — {r.reason}
                </span>
                {isOwner && r.status === 'ACTIVE' && (
                  <ReverseControl
                    isPending={reverseMoneyMutation.isPending}
                    onConfirm={(reason) => reverseMoneyMutation.mutate({ resolutionId: r._id, reason })}
                  />
                )}
                {r.status === 'REVERSED' && <span className="text-slate-400">reversed</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {original.notes && <p className="text-sm text-slate-500">Original notes: {original.notes}</p>}

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Corrections</h2>
        {corrections.length === 0 && <p className="text-xs text-slate-500">No corrections have been made.</p>}
        {corrections.map((c) => (
          <p key={c._id} className="text-xs text-slate-600">
            #{c.correctionNumber}: {c.totalQuantitySold} bags, {formatKoboAsNaira(c.expectedRevenueKobo)} revenue
          </p>
        ))}
        {canRequestCorrection ? (
          <Link
            to={`/daily-reports/${id}/request-correction`}
            className="block rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700"
          >
            Request Correction
          </Link>
        ) : (
          <p className="text-xs text-slate-500">
            An active variance resolution exists — reverse it before requesting a correction.
          </p>
        )}
      </div>
    </div>
  );
}
