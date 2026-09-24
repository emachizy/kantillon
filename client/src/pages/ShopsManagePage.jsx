import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchShops } from '../api/shops.js';
import { fetchUsers } from '../api/users.js';

// Staff counts are derived from the existing GET /api/users response (each
// user already carries its populated shopIds) rather than one
// GET /shops/:id/staff call per card — one extra request total, not N.
function ShopManageCard({ shop, staffCount }) {
  return (
    <Link
      to={`/shops/manage/${shop._id}`}
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition active:bg-slate-50"
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{shop.name}</p>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
              shop.isActive
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-slate-200 bg-slate-100 text-slate-500'
            }`}
          >
            {shop.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        {shop.address && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{shop.address}</p>}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">{staffCount} staff assigned</span>
        <span className="text-xs font-medium text-slate-500">Manage →</span>
      </div>
    </Link>
  );
}

export function ShopsManagePage() {
  const shopsQuery = useQuery({ queryKey: ['shops', { includeInactive: true }], queryFn: () => fetchShops({ includeInactive: true }) });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => fetchUsers() });

  const staffCountByShop = (usersQuery.data || []).reduce((counts, user) => {
    for (const shop of user.shopIds || []) {
      counts[shop._id] = (counts[shop._id] || 0) + 1;
    }
    return counts;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Shops</h1>
        <Link
          to="/shops/manage/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          + Add Shop
        </Link>
      </div>

      {shopsQuery.isLoading && <p className="text-sm text-slate-500">Loading shops...</p>}
      {shopsQuery.isError && <p className="text-sm text-red-600">Failed to load shops.</p>}

      {shopsQuery.isSuccess && shopsQuery.data.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <p className="text-sm text-slate-500">No shops yet.</p>
          <Link
            to="/shops/manage/new"
            className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Create first shop
          </Link>
        </div>
      )}

      {shopsQuery.isSuccess && shopsQuery.data.length > 0 && (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {shopsQuery.data.map((shop) => (
            <ShopManageCard key={shop._id} shop={shop} staffCount={staffCountByShop[shop._id] || 0} />
          ))}
        </div>
      )}
    </div>
  );
}
