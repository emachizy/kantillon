import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../api/products.js';

function ProductManageCard({ product }) {
  return (
    <Link
      to={`/products/manage/${product._id}`}
      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{product.name}</p>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${
            product.isActive
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-slate-200 bg-slate-100 text-slate-500'
          }`}
        >
          {product.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {product.sku} · {product.unit}
      </p>
      <span className="mt-2 text-xs font-medium text-slate-500">Manage →</span>
    </Link>
  );
}

export function ProductsManagePage() {
  const productsQuery = useQuery({
    queryKey: ['products', { includeInactive: true }],
    queryFn: () => fetchProducts({ includeInactive: true }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Products</h1>
        <Link
          to="/products/manage/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          + Add Product
        </Link>
      </div>

      {productsQuery.isLoading && <p className="text-sm text-slate-500">Loading products...</p>}
      {productsQuery.isError && <p className="text-sm text-red-600">Failed to load products.</p>}

      {productsQuery.isSuccess && productsQuery.data.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
          <p className="text-sm text-slate-500">No products yet.</p>
          <Link
            to="/products/manage/new"
            className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Create first product
          </Link>
        </div>
      )}

      {productsQuery.isSuccess && productsQuery.data.length > 0 && (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {productsQuery.data.map((product) => (
            <ProductManageCard key={product._id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
