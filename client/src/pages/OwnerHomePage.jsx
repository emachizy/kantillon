import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import { fetchShopInventory } from '../api/inventory.js';
import { fetchPendingReceipts } from '../api/stockReceipts.js';
import { ShopCard } from '../components/ShopCard.jsx';

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
  // Derived client-side from the same pending-receipts fetch used by the
  // banner below — no extra request per shop.
  const pendingCountByShop = (pendingQuery.data || []).reduce((counts, receipt) => {
    const id = receipt.shopId?._id;
    if (id) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});

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

      {shops.length === 0 ? (
        <p className="text-sm text-slate-500">No shops yet.</p>
      ) : (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {shops.map((shop, index) => (
            <ShopCard
              key={shop._id}
              shop={shop}
              stockQuery={inventoryQueries[index]}
              pendingCount={pendingCountByShop[shop._id] ?? 0}
            />
          ))}
        </div>
      )}

      <Link to="/receipts" className="block text-center text-sm text-slate-500 underline">
        View stock receipt history
      </Link>
    </div>
  );
}
