import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchEffectiveReport, requestCorrection } from '../api/corrections.js';
import { nairaInputToKobo, formatKoboAsNaira } from '../utils/money.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function emptyLine() {
  return { quantity: '', unitPriceNaira: '' };
}

export function CorrectionRequestFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const effectiveQuery = useQuery({
    queryKey: ['dailyReports', 'effective', id],
    queryFn: () => fetchEffectiveReport(id),
  });

  const [lines, setLines] = useState(null);
  const [physicalClosing, setPhysicalClosing] = useState(null);
  const [actualCollectedNaira, setActualCollectedNaira] = useState(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState(null);

  // Prefill once, from the effective (current) values.
  if (effectiveQuery.data && lines === null) {
    const { effective } = effectiveQuery.data;
    setLines(
      effective.salesLines.map((l) => ({
        quantity: String(l.quantity),
        unitPriceNaira: (l.unitPriceKobo / 100).toFixed(2),
      }))
    );
    setPhysicalClosing(String(effective.physicalClosingStockQuantity));
    setActualCollectedNaira((effective.actualAmountCollectedKobo / 100).toFixed(2));
  }

  const mutation = useMutation({
    mutationFn: (payload) => requestCorrection(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
      navigate(`/daily-reports/${id}`);
    },
  });

  if (effectiveQuery.isLoading || lines === null) {
    return <p className="text-sm text-slate-500">Loading current report values...</p>;
  }
  if (effectiveQuery.isError) {
    const status = effectiveQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403 ? 'You do not have access to this report.' : 'Failed to load report.'}
      </p>
    );
  }

  const { effective } = effectiveQuery.data;

  function updateLine(index, field, value) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  }

  function addLine() {
    if (lines.length >= 20) return;
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  let previewTotalQuantity = 0;
  let previewExpectedRevenueKobo = 0;
  let previewValid = lines.length > 0;
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      previewValid = false;
      continue;
    }
    let unitPriceKobo;
    try {
      unitPriceKobo = nairaInputToKobo(line.unitPriceNaira || '0');
    } catch {
      previewValid = false;
      continue;
    }
    previewTotalQuantity += quantity;
    previewExpectedRevenueKobo += quantity * unitPriceKobo;
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    try {
      const proposedSalesLines = lines.map((line) => ({
        quantity: Number(line.quantity),
        unitPriceKobo: nairaInputToKobo(line.unitPriceNaira),
      }));
      mutation.mutate({
        reason,
        proposedSalesLines,
        proposedPhysicalClosingStockQuantity: Number(physicalClosing),
        proposedActualAmountCollectedKobo: nairaInputToKobo(actualCollectedNaira || '0'),
        proposedNotes: notes || undefined,
      });
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Request a correction</h1>
      <p className="text-sm text-slate-500">
        Correcting a mistake in what was reported — not a real stock/money discrepancy.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">Sales lines</p>
          {lines.map((line, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Quantity"
                value={line.quantity}
                onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                required
                className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unit price (₦)"
                value={line.unitPriceNaira}
                onChange={(e) => updateLine(index, 'unitPriceNaira', e.target.value)}
                required
                className="w-1/2 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="rounded-md border border-slate-300 px-2 text-sm text-slate-500"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {lines.length < 20 && (
            <button type="button" onClick={addLine} className="text-sm font-medium text-slate-700 underline">
              + Add another price
            </button>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Physical bags remaining</label>
          <input
            type="number"
            min="0"
            step="1"
            value={physicalClosing}
            onChange={(e) => setPhysicalClosing(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Actual amount collected (₦)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={actualCollectedNaira}
            onChange={(e) => setActualCollectedNaira(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Correction reason (required)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {previewValid && (
          <div className="space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Current → Proposed</p>
            <p>
              Bags sold: {effective.totalQuantitySold} → {previewTotalQuantity}
            </p>
            <p>
              Expected revenue: {formatKoboAsNaira(effective.expectedRevenueKobo)} →{' '}
              {formatKoboAsNaira(previewExpectedRevenueKobo)}
            </p>
            <p>
              Physical closing: {effective.physicalClosingStockQuantity} → {physicalClosing || '—'}
            </p>
            <p className="pt-1 text-slate-500">Backend values are authoritative once submitted.</p>
          </div>
        )}

        {(formError || mutation.isError) && (
          <p className="text-sm text-red-600">
            {formError || errorMessage(mutation.error, 'Could not submit correction request.')}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Submitting...' : 'Submit correction request'}
        </button>
      </form>
    </div>
  );
}
