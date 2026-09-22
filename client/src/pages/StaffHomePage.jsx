import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';

// GET /api/shops is already scoped server-side to this user's assigned
// shops, so there's no client-side filtering to do here.
export function StaffHomePage() {
  const shopsQuery = useQuery({ queryKey: ['shops'], queryFn: fetchShops });

  if (shopsQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading your shops...</p>;
  }
  if (shopsQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load your shops. Pull to refresh.</p>;
  }

  const shops = shopsQuery.data || [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Your shops</h1>

      <div className="space-y-2">
        {shops.length === 0 && (
          <p className="text-sm text-slate-500">You are not assigned to any shop yet.</p>
        )}
        {shops.map((shop) => (
          <Link
            key={shop._id}
            to={`/shops/${shop._id}`}
            className="block rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <span className="font-medium text-slate-900">{shop.name}</span>
            <p className="text-xs text-slate-400">{shop.code}</p>
          </Link>
        ))}
      </div>

      <Link to="/receipts" className="block text-center text-sm text-slate-500 underline">
        View my stock receipt history
      </Link>
    </div>
  );
}
