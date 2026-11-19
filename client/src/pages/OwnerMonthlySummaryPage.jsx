import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMonthlySummary } from '../api/dailyReports.js';
import { fetchShops } from '../api/shops.js';
import { getCurrentLagosBusinessMonth } from '../utils/businessDate.js';
import { formatKoboAsNaira } from '../utils/money.js';

function varianceLabel(varianceKobo) {
  if (varianceKobo === 0) return 'Balanced';
  return varianceKobo < 0
    ? `${formatKoboAsNaira(Math.abs(varianceKobo))} short`
    : `${formatKoboAsNaira(varianceKobo)} excess`;
}

function stockVarianceLabel(variance) {
  if (variance === 0) return 'Balanced';
  return variance < 0 ? `${Math.abs(variance)} bags short` : `${variance} bags surplus`;
}

// Sales-performance first: quantity sold, expected sales, actual
// collections, product performance, then daily performance — stock/money
// variance appear only as a single supporting line on the month-total
// card, never as the page's headline (see README "Monthly Sales Summary").
export function OwnerMonthlySummaryPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const [month, setMonth] = useState(getCurrentLagosBusinessMonth());

  // The backend already scopes this list to the caller's assigned shops
  // (OWNER sees all) — same source the Shops/Add User pages already use,
  // so the picker only ever offers shops this user can actually open.
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: () => fetchShops() });

  const summaryQuery = useQuery({
    queryKey: ['dailyReports', 'monthlySummary', shopId, month],
    queryFn: () => fetchMonthlySummary(shopId, month),
    enabled: Boolean(shopId),
  });

  function handleShopChange(e) {
    const nextShopId = e.target.value;
    if (nextShopId) navigate(`/monthly-summary/${nextShopId}`, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Monthly Sales Summary</h1>
        <Link to="/daily-summary" className="text-xs font-medium text-slate-500">
          ← Daily view
        </Link>
      </div>

      <div>
        <label htmlFor="shop" className="mb-1 block text-xs font-medium text-slate-500">
          Shop
        </label>
        {shopsQuery.isLoading && <p className="text-sm text-slate-500">Loading shops...</p>}
        {shopsQuery.isError && <p className="text-sm text-red-600">Failed to load shops.</p>}
        {shopsQuery.isSuccess && shopsQuery.data.length === 0 && (
          <p className="text-sm text-slate-500">No shops available.</p>
        )}
        {shopsQuery.isSuccess && shopsQuery.data.length > 0 && (
          <select
            id="shop"
            value={shopId || ''}
            onChange={handleShopChange}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select a shop...
            </option>
            {shopsQuery.data.map((shop) => (
              <option key={shop._id} value={shop._id}>
                {shop.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!shopId && (
        <p className="text-sm text-slate-500">Select a shop above to see its monthly sales summary.</p>
      )}

      {shopId && (
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      )}

      {shopId && summaryQuery.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
      {shopId && summaryQuery.isError && (
        <p className="text-sm text-red-600">
          {summaryQuery.error?.response?.status === 403
            ? 'You do not have access to this shop.'
            : summaryQuery.error?.response?.status === 404
              ? 'Shop not found.'
              : 'Failed to load summary.'}
        </p>
      )}

      {shopId && summaryQuery.isSuccess && (
        <div className="space-y-4">
          {/* Selected shop is always named here, so it's never ambiguous
              which shop's figures are on screen. */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {summaryQuery.data.shop.name} · {month}
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {summaryQuery.data.totals.totalQuantitySold} {summaryQuery.data.totals.totalQuantitySold === 1 ? 'bag' : 'bags'} sold
            </p>
            <p className="mt-2 text-sm text-slate-700">
              Expected sales: {formatKoboAsNaira(summaryQuery.data.totals.expectedRevenueKobo)}
            </p>
            <p className="text-sm text-slate-700">
              Actual collected: {formatKoboAsNaira(summaryQuery.data.totals.actualAmountCollectedKobo)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {summaryQuery.data.totals.daysReported}{' '}
              {summaryQuery.data.totals.daysReported === 1 ? 'day' : 'days'} with submitted reports
            </p>
            <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-400">
              <p>Collection variance: {varianceLabel(summaryQuery.data.totals.moneyVarianceKobo)}</p>
              <p>Stock variance: {stockVarianceLabel(summaryQuery.data.totals.stockVarianceQuantity)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Product performance
            </h2>
            {summaryQuery.data.products.length === 0 ? (
              <p className="text-sm text-slate-500">No daily reports submitted this month yet.</p>
            ) : (
              <div className="space-y-2">
                {summaryQuery.data.products.map((row) => (
                  <div key={row.product?.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="font-medium text-slate-900">{row.product?.name}</p>
                    <p className="text-sm text-slate-700">Bags sold: {row.totalQuantitySold}</p>
                    <p className="text-sm text-slate-700">
                      Expected: {formatKoboAsNaira(row.expectedRevenueKobo)} · Collected:{' '}
                      {formatKoboAsNaira(row.actualAmountCollectedKobo)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summaryQuery.data.days.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Daily performance
              </h2>
              {/* One compact card per day rather than a wide table — every
                  field stacks vertically so nothing is cut off or requires
                  horizontal scrolling on a narrow phone. */}
              <div className="space-y-2">
                {summaryQuery.data.days.map((day) => (
                  <div key={day.businessDate} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="font-medium text-slate-900">{day.businessDate}</p>
                    <p className="text-sm text-slate-700">Bags sold: {day.totalQuantitySold}</p>
                    <p className="text-sm text-slate-700">
                      Expected: {formatKoboAsNaira(day.expectedRevenueKobo)} · Collected:{' '}
                      {formatKoboAsNaira(day.actualAmountCollectedKobo)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Collection variance: {varianceLabel(day.moneyVarianceKobo)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
