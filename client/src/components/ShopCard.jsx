import { Link } from 'react-router-dom';

// A compact, tappable shop card for the shop grid. Deliberately shows only
// data already available from existing queries (shop list + per-shop
// inventory + pending-receipt counts) — no new API calls are introduced
// here just to fill out the card.
export function ShopCard({ shop, stockQuery, pendingCount }) {
  const firstLine = stockQuery?.data?.inventory?.[0];
  const extraProductCount = (stockQuery?.data?.inventory?.length ?? 0) - 1;

  return (
    <Link
      to={`/shops/${shop._id}`}
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition active:bg-slate-50"
    >
      <div>
        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{shop.name}</p>
        <p className="text-xs text-slate-400">{shop.code}</p>
      </div>

      <div className="mt-2 min-h-[2rem] space-y-0.5">
        {stockQuery?.isLoading && <p className="text-xs text-slate-400">Loading stock…</p>}
        {stockQuery?.isError && <p className="text-xs text-slate-400">Stock unavailable</p>}
        {stockQuery?.isSuccess && firstLine && (
          <p className="text-xs text-slate-600">
            <span className="font-medium text-slate-900">
              {firstLine.balance} {firstLine.product.unit}
            </span>
            {extraProductCount > 0 && ` · +${extraProductCount} more`}
          </p>
        )}
        {stockQuery?.isSuccess && !firstLine && <p className="text-xs text-slate-400">No products yet</p>}
        {pendingCount > 0 && (
          <p className="text-xs font-medium text-amber-700">
            {pendingCount} pending approval{pendingCount === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <span className="mt-2 text-xs font-medium text-slate-500">Manage shop →</span>
    </Link>
  );
}
