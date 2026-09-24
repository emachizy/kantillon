import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createShop } from '../api/shops.js';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

export function AddShopPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const createMutation = useMutation({
    mutationFn: createShop,
    onSuccess: () => {
      // Every page that lists shops (owner home, shop management, the
      // Add/Manage User shop checklists) reads through this one query key.
      queryClient.invalidateQueries({ queryKey: ['shops'] });
      navigate('/shops/manage');
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    createMutation.mutate({
      name,
      address: address || undefined,
      phone: phone || undefined,
      notes: notes || undefined,
    });
  }

  return (
    <div className="space-y-4">
      <Link to="/shops/manage" className="inline-block text-sm text-slate-500">
        ← Shops
      </Link>
      <h1 className="text-lg font-semibold text-slate-900">Add Shop</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            Address (optional)
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
            Phone (optional)
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
            Notes (optional)
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {createMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(createMutation.error, 'Could not create shop.')}</p>
        )}

        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating...' : 'Create Shop'}
        </button>
      </form>
    </div>
  );
}
