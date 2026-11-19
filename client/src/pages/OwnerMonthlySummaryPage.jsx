import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMonthlySummary } from '../api/dailyReports.js';
import { getCurrentLagosBusinessMonth } from '../utils/businessDate.js';
import { formatKoboAsNaira } from '../utils/money.js';

function stockStatus(variance) {
  if (variance === 0) return 'BALANCED';
  return variance < 0 ? `${Math.abs(variance)} bags short (SHORTAGE)` : `${variance} bags surplus (SURPLUS)`;
}

function moneyStatus(varianceKobo) {
  if (varianceKobo === 0) return 'BALANCED';
  return varianceKobo < 0
    ? `${formatKoboAsNaira(Math.abs(varianceKobo))} short`
    : `${formatKoboAsNaira(varianceKobo)} excess`;
}

export function OwnerMonthlySummaryPage() {
  const [month, setMonth] = useState(getCurrentLagosBusinessMonth());

  const summaryQuery = useQuery({
    queryKey: ['dailyReports', 'monthlySummary', month],
    queryFn: () => fetchMonthlySummary(month),
  });

  const rows = summaryQuery.data?.rows || [];
  const monthTotals = rows.reduce(
    (totals, row) => ({
      totalQuantitySold: totals.totalQuantitySold + row.totalQuantitySold,
      expectedRevenueKobo: totals.expectedRevenueKobo + row.expectedRevenueKobo,
      actualAmountCollectedKobo: totals.actualAmountCollectedKobo + row.actualAmountCollectedKobo,
    }),
    { totalQuantitySold: 0, expectedRevenueKobo: 0, actualAmountCollectedKobo: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Monthly reconciliation summary</h1>
        <Link to="/daily-summary" className="text-xs font-medium text-slate-500">
          ← Daily view
        </Link>
      </div>

      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      {summaryQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {summaryQuery.isError && <p className="text-sm text-red-600">Failed to load summary.</p>}

      {summaryQuery.isSuccess && (
        <div className="space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-slate-500">No daily reports submitted this month yet.</p>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Month total</p>
              <p className="text-sm text-slate-700">Bags sold: {monthTotals.totalQuantitySold}</p>
              <p className="text-sm text-slate-700">
                Expected revenue: {formatKoboAsNaira(monthTotals.expectedRevenueKobo)} · Collected:{' '}
                {formatKoboAsNaira(monthTotals.actualAmountCollectedKobo)}
              </p>
            </div>
          )}

          {rows.map((row) => (
            <div
              key={`${row.shop?.id}-${row.product?.id}`}
              className="space-y-1 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{row.shop?.name}</span>
                <span className="text-xs text-slate-400">{row.product?.name}</span>
              </div>
              <p className="text-xs text-slate-400">
                {row.reportCount} day{row.reportCount === 1 ? '' : 's'} reported
              </p>
              <p className="text-sm text-slate-700">Bags sold: {row.totalQuantitySold}</p>
              <p className="text-sm font-medium text-slate-900">
                Stock: {stockStatus(row.stockVarianceQuantity)}
              </p>
              <p className="text-sm text-slate-700">
                Expected revenue: {formatKoboAsNaira(row.expectedRevenueKobo)} · Collected:{' '}
                {formatKoboAsNaira(row.actualAmountCollectedKobo)}
              </p>
              <p className="text-sm font-medium text-slate-900">
                Money: {moneyStatus(row.moneyVarianceKobo)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
