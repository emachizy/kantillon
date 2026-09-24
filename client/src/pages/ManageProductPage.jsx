import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProduct, updateProduct, deactivateProduct, reactivateProduct } from '../api/products.js';
import { fetchCurrentPricesForProduct, setShopPrice } from '../api/shopPrices.js';
import { ShopPriceRow } from '../components/ShopPriceRow.jsx';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

export function ManageProductPage() {
  const { productId } = useParams();
  const queryClient = useQueryClient();
  const productQuery = useQuery({ queryKey: ['products', productId], queryFn: () => fetchProduct(productId) });
  const pricesQuery = useQuery({
    queryKey: ['shop-prices', 'product', productId],
    queryFn: () => fetchCurrentPricesForProduct(productId),
  });

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');

  useEffect(() => {
    if (productQuery.data) {
      setName(productQuery.data.name || '');
      setUnit(productQuery.data.unit || '');
    }
  }, [productQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const updateMutation = useMutation({ mutationFn: updateProduct, onSuccess: invalidate });
  const deactivateMutation = useMutation({ mutationFn: deactivateProduct, onSuccess: invalidate });
  const reactivateMutation = useMutation({ mutationFn: reactivateProduct, onSuccess: invalidate });
  const priceMutation = useMutation({
    mutationFn: setShopPrice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shop-prices'] }),
  });

  if (productQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading product...</p>;
  }
  if (productQuery.isError) {
    return <p className="text-sm text-red-600">Failed to load product.</p>;
  }

  const product = productQuery.data;

  return (
    <div className="space-y-4">
      <Link to="/products/manage" className="inline-block text-sm text-slate-500">
        ← Products
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-slate-900">{product.name}</h1>
        <p className="text-xs text-slate-400">
          {product.sku} · {product.unit}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
            product.isActive
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-slate-200 bg-slate-100 text-slate-500'
          }`}
        >
          {product.isActive ? 'Active' : 'Inactive'}
        </span>
        <button
          type="button"
          disabled={deactivateMutation.isPending || reactivateMutation.isPending}
          onClick={() =>
            product.isActive ? deactivateMutation.mutate(product._id) : reactivateMutation.mutate(product._id)
          }
          className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          {product.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
        {!product.isActive && (
          <p className="mt-2 text-xs text-slate-500">
            Inactive products no longer appear in shop operational pages; historical inventory, receipts,
            reports, and prices are preserved.
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMutation.mutate({ id: product._id, name, unit });
        }}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Product Details</p>

        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Product Name
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
          <label htmlFor="unit" className="mb-1 block text-sm font-medium text-slate-700">
            Unit
          </label>
          <input
            id="unit"
            type="text"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shop Prices</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {pricesQuery.isLoading && <p className="text-sm text-slate-500">Loading prices...</p>}
          {pricesQuery.isSuccess && pricesQuery.data.length === 0 && (
            <p className="text-sm text-slate-500">No active shops yet.</p>
          )}
          {(pricesQuery.data || []).map((row) => (
            <ShopPriceRow
              key={row.shop.id}
              label={row.shop.name}
              priceKobo={row.priceKobo}
              isPending={priceMutation.isPending}
              error={priceMutation.isError ? priceMutation.error : null}
              onSave={(priceKobo, onDone) =>
                priceMutation.mutate(
                  { shopId: row.shop.id, productId: product._id, priceKobo },
                  { onSuccess: onDone }
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
