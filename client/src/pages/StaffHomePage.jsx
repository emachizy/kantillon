import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import { fetchShopInventory } from '../api/inventory.js';
import { ShopCard } from '../components/ShopCard.jsx';

// GET /api/shops is already scoped server-side to this user's assigned
// shops, so there's no client-side filtering to do here.
export function StaffHomePage() {
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: fetchShops });

  const shops = shopsQuery.data || [];
  const inventoryQueries = useQueries({
    queries: shops.map((shop) => ({
      queryKey: ['inventory', 'shop', shop._id],
      queryFn: () => fetchShopInventory(shop._id),
    })),
  });

  if (shopsQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading your shops...</p>;
  }
  if (shopsQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load your shops. Pull to refresh.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Your shops</h1>

      {shops.length === 0 ? (
        <p className="text-sm text-slate-500">You are not assigned to any shop yet.</p>
      ) : (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {shops.map((shop, index) => (
            <ShopCard key={shop._id} shop={shop} stockQuery={inventoryQueries[index]} />
          ))}
        </div>
      )}

      <Link to="/receipts" className="block text-center text-sm text-slate-500 underline">
        View my stock receipt history
      </Link>
    </div>
  );
}
