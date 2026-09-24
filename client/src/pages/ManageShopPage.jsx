import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchShop, updateShop, deactivateShop, reactivateShop } from '../api/shops.js';
import { fetchCurrentPricesForShop, setShopPrice } from '../api/shopPrices.js';
import { ShopStaffSection } from '../components/ShopStaffSection.jsx';
import { ShopPriceRow } from '../components/ShopPriceRow.jsx';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

export function ManageShopPage() {
  const { shopId } = useParams();
  const queryClient = useQueryClient();
  const shopQuery = useQuery({ queryKey: ['shops', shopId], queryFn: () => fetchShop(shopId) });
  const pricesQuery = useQuery({
    queryKey: ['shop-prices', 'shop', shopId],
    queryFn: () => fetchCurrentPricesForShop(shopId),
  });

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (shopQuery.data) {
      setName(shopQuery.data.name || '');
      setAddress(shopQuery.data.address || '');
      setPhone(shopQuery.data.phone || '');
      setNotes(shopQuery.data.notes || '');
    }
  }, [shopQuery.data]);

  function invalidate() {
    // Every page that lists shops (owner home, shop management list, the
    // Add/Manage User shop checklists) reads through the 'shops' query key.
    queryClient.invalidateQueries({ queryKey: ['shops'] });
  }

  const updateMutation = useMutation({ mutationFn: updateShop, onSuccess: invalidate });
  const deactivateMutation = useMutation({ mutationFn: deactivateShop, onSuccess: invalidate });
  const reactivateMutation = useMutation({ mutationFn: reactivateShop, onSuccess: invalidate });
  const priceMutation = useMutation({
    mutationFn: setShopPrice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shop-prices'] }),
  });

  if (shopQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading shop...</p>;
  }
  if (shopQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load shop.</p>;
  }

  const shop = shopQuery.data;

  return (
    <div className="space-y-4">
      <Link to="/shops/manage" className="inline-block text-sm text-slate-500">
        ← Shops
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-slate-900">{shop.name}</h1>
        <p className="text-xs text-slate-400">{shop.code}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
            shop.isActive
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-slate-200 bg-slate-100 text-slate-500'
          }`}
        >
          {shop.isActive ? 'Active' : 'Inactive'}
        </span>
        <button
          type="button"
          disabled={deactivateMutation.isPending || reactivateMutation.isPending}
          onClick={() => (shop.isActive ? deactivateMutation.mutate(shop._id) : reactivateMutation.mutate(shop._id))}
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          {shop.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
        {!shop.isActive && (
          <p className="mt-2 text-xs text-slate-500">
            Inactive shops keep all historical records; staff cannot submit new stock receipts, opening
            stock, or daily reports here until it is reactivated.
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMutation.mutate({ id: shop._id, name, address, phone, notes });
        }}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shop Details</p>

        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Shop Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium text-slate-700">
            Address
          </label>
          <input
            id="address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
            Phone
          </label>
          <input
            id="phone"
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium text-slate-700">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {updateMutation.isError && (
          <p className="text-xs text-red-600">{errorMessage(updateMutation.error, 'Could not save changes.')}</p>
        )}
        {updateMutation.isSuccess && <p className="text-xs text-green-700">Saved.</p>}

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save changes'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Products & Prices</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {pricesQuery.isLoading && <p className="text-sm text-slate-500">Loading prices...</p>}
          {pricesQuery.isSuccess && pricesQuery.data.length === 0 && (
            <p className="text-sm text-slate-500">No active products yet.</p>
          )}
          {(pricesQuery.data || []).map((row) => (
            <ShopPriceRow
              key={row.product.id}
              label={row.product.name}
              priceKobo={row.priceKobo}
              isPending={priceMutation.isPending}
              error={priceMutation.isError ? priceMutation.error : null}
              onSave={(priceKobo, onDone) =>
                priceMutation.mutate(
                  { shopId: shop._id, productId: row.product.id, priceKobo },
                  { onSuccess: onDone }
                )
              }
            />
          ))}
        </div>
      </div>

      <ShopStaffSection shopId={shop._id} />

      <Link
        to={`/shops/${shop._id}`}
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700"
      >
        Open Shop Dashboard →
      </Link>
    </div>
  );
}
