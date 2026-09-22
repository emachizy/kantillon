import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import { fetchShopInventory } from '../api/inventory.js';
import { fetchPendingReceipts } from '../api/stockReceipts.js';

export function OwnerHomePage() {
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: fetchShops });
  const pendingQuery = useQuery({ queryKey: ['stockReceipts', 'pending'], queryFn: fetchPendingReceipts });

  const shops = shopsQuery.data || [];
  const inventoryQueries = useQueries({
    queries: shops.map((shop) => ({
      queryKey: ['inventory', 'shop', shop._id],
      queryFn: () => fetchShopInventory(shop._id),
    })),
  });

  if (shopsQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading shops...</p>;
  }
  if (shopsQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load shops. Pull to refresh.</p>;
  }

  const pendingCount = pendingQuery.data?.length ?? null;

  return (
    <div className="space-y-4">
      <Link
        to="/approvals"
        className="block rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <p className="text-sm font-medium text-amber-800">
          {pendingQuery.isLoading
            ? 'Checking pending approvals...'
            : `${pendingCount ?? 0} pending stock approval${pendingCount === 1 ? '' : 's'}`}
        </p>
        <p className="text-xs text-amber-700">Tap to review</p>
      </Link>

      <div className="space-y-2">
        {shops.length === 0 && <p className="text-sm text-slate-500">No shops yet.</p>}
        {shops.map((shop, index) => {
          const inv = inventoryQueries[index];
          const firstLine = inv?.data?.inventory?.[0];
          return (
            <Link
              key={shop._id}
              to={`/shops/${shop._id}`}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{shop.name}</span>
                <span className="text-sm text-slate-500">
                  {inv?.isLoading && 'Loading...'}
                  {inv?.isError && 'Unavailable'}
                  {firstLine && `${firstLine.balance} ${firstLine.product.unit}`}
                  {inv?.isSuccess && !firstLine && 'No products'}
                </span>
              </div>
              <p className="text-xs text-slate-400">{shop.code}</p>
            </Link>
          );
        })}
      </div>

      <Link to="/receipts" className="block text-center text-sm text-slate-500 underline">
        View stock receipt history
      </Link>
    </div>
  );
}
