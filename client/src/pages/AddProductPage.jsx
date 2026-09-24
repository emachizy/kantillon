import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProduct } from '../api/products.js';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

export function AddProductPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('bag');

  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      // Every page that lists products (shop operational pages, product
      // management, daily report price defaulting) reads through this key.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      navigate('/products/manage');
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    createMutation.mutate({ name, unit: unit || undefined });
  }

  return (
    <div className="space-y-4">
      <Link to="/products/manage" className="inline-block text-sm text-slate-500">
        ← Products
      </Link>
      <h1 className="text-lg font-semibold text-slate-900">Add Product</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
            Product Name
          </label>
          <input
            id="name"
            type="text"
            required
            placeholder="Lafarge Cement"
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
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {createMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(createMutation.error, 'Could not create product.')}</p>
        )}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating...' : 'Create Product'}
        </button>
      </form>
    </div>
  );
}
