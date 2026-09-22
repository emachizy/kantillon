import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { submitDailyReport } from '../api/dailyReports.js';
import { fetchCurrentShopPrice } from '../api/shopPrices.js';
import { fetchShopInventory } from '../api/inventory.js';
import { getTodayLagosBusinessDate } from '../utils/businessDate.js';
import { nairaInputToKobo, formatKoboAsNaira } from '../utils/money.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function emptyLine() {
  return { quantity: '', unitPriceNaira: '' };
}

export function DailyReportFormPage() {
  const { shopId, productId } = useParams();
  const queryClient = useQueryClient();

  const [businessDate, setBusinessDate] = useState(getTodayLagosBusinessDate());
  const [lines, setLines] = useState([emptyLine()]);
  const [physicalClosing, setPhysicalClosing] = useState('');
  const [actualCollectedNaira, setActualCollectedNaira] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState(null);

  const inventoryQuery = useQuery({
    queryKey: ['inventory', 'shop', shopId],
    queryFn: () => fetchShopInventory(shopId),
  });
  const priceQuery = useQuery({
    queryKey: ['shopPrice', 'current', shopId, productId],
    queryFn: () => fetchCurrentShopPrice(shopId, productId),
  });

  // Default the first line's price to the active ShopPrice, once, when it
  // loads — staff can still change it if the actual selling price differed.
  useEffect(() => {
    if (priceQuery.data && !lines[0].unitPriceNaira) {
      setLines((prev) => {
        const next = [...prev];
        next[0] = { ...next[0], unitPriceNaira: (priceQuery.data.priceKobo / 100).toFixed(2) };
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceQuery.data]);

  const mutation = useMutation({
    mutationFn: submitDailyReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'shop', shopId] });
      queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
    },
  });

  const product = inventoryQuery.data?.inventory.find((line) => line.product.id === productId)
    ?.product;

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
    if (unitPriceKobo <= 0) previewValid = false;
    previewTotalQuantity += quantity;
    previewExpectedRevenueKobo += quantity * unitPriceKobo;
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    try {
      const salesLines = lines.map((line) => ({
        quantity: Number(line.quantity),
        unitPriceKobo: nairaInputToKobo(line.unitPriceNaira),
      }));
      const physicalClosingStockQuantity = Number(physicalClosing);
      const actualAmountCollectedKobo = nairaInputToKobo(actualCollectedNaira || '0');

      mutation.mutate({
        shopId,
        productId,
        businessDate,
        salesLines,
        physicalClosingStockQuantity,
        actualAmountCollectedKobo,
        notes: notes || undefined,
      });
    } catch (err) {
      setFormError(err.message);
    }
  }

  if (mutation.isSuccess) {
    const { report } = mutation.data;
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Daily report submitted</h1>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <Row label="Bags sold" value={report.totalQuantitySold} />
          <Row label="Expected closing" value={report.expectedClosingStockQuantity} />
          <Row label="Physical closing" value={report.physicalClosingStockQuantity} />
          <VarianceRow
            label="Stock variance"
            value={report.stockVarianceQuantity}
            unit="bags"
          />
          <Row label="Expected revenue" value={formatKoboAsNaira(report.expectedRevenueKobo)} />
          <Row label="Amount collected" value={formatKoboAsNaira(report.actualAmountCollectedKobo)} />
          <VarianceRow
            label="Money variance"
            value={report.moneyVarianceKobo}
            format={formatKoboAsNaira}
          />
        </div>
        <Link to={`/shops/${shopId}`} className="block text-center text-sm text-slate-500 underline">
          Back to shop
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">
        Daily report{product ? ` — ${product.name}` : ''}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Business date</label>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

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
            <button
              type="button"
              onClick={addLine}
              className="text-sm font-medium text-slate-700 underline"
            >
              + Add another price
            </button>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Physical bags remaining
          </label>
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
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Actual amount collected (₦)
          </label>
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
          <label className="mb-1 block text-sm font-medium text-slate-700">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {previewValid && (
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p>Preview (backend values are authoritative):</p>
            <p>Total bags sold: {previewTotalQuantity}</p>
            <p>Expected revenue: {formatKoboAsNaira(previewExpectedRevenueKobo)}</p>
          </div>
        )}

        {(formError || mutation.isError) && (
          <p className="text-sm text-red-600">
            {formError || errorMessage(mutation.error, 'Could not submit daily report.')}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Submitting...' : 'Submit Daily Report'}
        </button>
      </form>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function VarianceRow({ label, value, unit = '', format }) {
  const display = format ? format(value) : `${value} ${unit}`.trim();
  let statusLabel = 'BALANCED';
  if (value < 0) statusLabel = unit === 'bags' ? 'SHORTAGE' : 'MONEY SHORT';
  if (value > 0) statusLabel = unit === 'bags' ? 'SURPLUS' : 'MONEY SURPLUS';

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">
        {display} <span className="text-xs text-slate-500">({statusLabel})</span>
      </span>
    </div>
  );
}
