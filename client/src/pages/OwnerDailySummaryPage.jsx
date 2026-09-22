import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDailySummary } from '../api/dailyReports.js';
import { getTodayLagosBusinessDate } from '../utils/businessDate.js';
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

export function OwnerDailySummaryPage() {
  const [businessDate, setBusinessDate] = useState(getTodayLagosBusinessDate());

  const summaryQuery = useQuery({
    queryKey: ['dailyReports', 'summary', businessDate],
    queryFn: () => fetchDailySummary(businessDate),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Daily reconciliation summary</h1>

      <input
        type="date"
        value={businessDate}
        onChange={(e) => setBusinessDate(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      {summaryQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {summaryQuery.isError && <p className="text-sm text-red-600">Failed to load summary.</p>}

      {summaryQuery.data && (
        <div className="space-y-3">
          {summaryQuery.data.reports.length === 0 && (
            <p className="text-sm text-slate-500">No daily reports submitted for this date yet.</p>
          )}
          {summaryQuery.data.reports.map((report) => (
            <Link
              key={report._id}
              to={`/daily-reports/${report._id}`}
              className="block space-y-1 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{report.shopId?.name}</span>
                <span className="text-xs text-slate-400">{report.productId?.name}</span>
              </div>
              <p className="text-sm text-slate-700">Bags sold: {report.totalQuantitySold}</p>
              <p className="text-sm text-slate-700">
                Expected closing: {report.expectedClosingStockQuantity} · Physical closing:{' '}
                {report.physicalClosingStockQuantity}
              </p>
              <p className="text-sm font-medium text-slate-900">
                Stock: {stockStatus(report.stockVarianceQuantity)}
              </p>
              <p className="text-sm text-slate-700">
                Expected revenue: {formatKoboAsNaira(report.expectedRevenueKobo)} · Collected:{' '}
                {formatKoboAsNaira(report.actualAmountCollectedKobo)}
              </p>
              <p className="text-sm font-medium text-slate-900">
                Money: {moneyStatus(report.moneyVarianceKobo)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
