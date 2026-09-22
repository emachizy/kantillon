import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchShopInventory, createOpeningStock } from '../api/inventory.js';
import { submitStockReceipt } from '../api/stockReceipts.js';

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function OpeningStockForm({ product, onSubmit, isPending, error, isSuccess }) {
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onSubmit(parsed, notes);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <p className="text-xs font-medium text-slate-600">Not initialized — set opening stock</p>
      <input
        type="number"
        min="1"
        step="1"
        placeholder={`Quantity (${product.unit})`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{errorMessage(error, 'Could not set opening stock.')}</p>}
      {isSuccess && <p className="text-xs text-green-700">Opening stock initialized.</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Saving...' : 'Initialize opening stock'}
      </button>
    </form>
  );
}

function ReceiptForm({ product, onSubmit, isPending, error, isSuccess }) {
  const [quantity, setQuantity] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onSubmit({ quantity: parsed, deliveryReference: deliveryReference || undefined, notes: notes || undefined });
    setQuantity('');
    setDeliveryReference('');
    setNotes('');
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <p className="text-xs font-medium text-slate-600">Report stock received</p>
      <input
        type="number"
        min="1"
        step="1"
        placeholder={`Quantity (${product.unit})`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Delivery reference (optional)"
        value={deliveryReference}
        onChange={(e) => setDeliveryReference(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{errorMessage(error, 'Could not submit stock receipt.')}</p>}
      {isSuccess && <p className="text-xs text-green-700">Submitted — awaiting owner approval.</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Submitting...' : 'Submit stock receipt'}
      </button>
    </form>
  );
}

export function ShopInventoryPage() {
  const { shopId } = useParams();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();

  const inventoryQuery = useQuery({
    queryKey: ['inventory', 'shop', shopId],
    queryFn: () => fetchShopInventory(shopId),
  });

  const openingStockMutation = useMutation({
    mutationFn: createOpeningStock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'shop', shopId] });
    },
  });

  const receiptMutation = useMutation({
    mutationFn: submitStockReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'shop', shopId] });
      queryClient.invalidateQueries({ queryKey: ['stockReceipts'] });
    },
  });

  if (inventoryQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading inventory...</p>;
  }
  if (inventoryQuery.isError) {
    const status = inventoryQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403 ? 'You do not have access to this shop.' : 'Failed to load inventory.'}
      </p>
    );
  }

  const { shop, inventory } = inventoryQuery.data;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">{shop.name}</h1>

      <div className="space-y-3">
        {inventory.length === 0 && <p className="text-sm text-slate-500">No products configured.</p>}
        {inventory.map((line) => (
          <div key={line.product.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{line.product.name}</span>
              <span className="text-sm text-slate-700">
                {line.balance} {line.product.unit}
              </span>
            </div>

            {isOwner && !line.initialized && (
              <OpeningStockForm
                product={line.product}
                isPending={openingStockMutation.isPending}
                error={openingStockMutation.error}
                isSuccess={
                  openingStockMutation.isSuccess &&
                  openingStockMutation.variables?.productId === line.product.id
                }
                onSubmit={(quantity, notes) =>
                  openingStockMutation.mutate({ shopId, productId: line.product.id, quantity, notes })
                }
              />
            )}

            {!isOwner && (
              <>
                <ReceiptForm
                  product={line.product}
                  isPending={receiptMutation.isPending}
                  error={receiptMutation.error}
                  isSuccess={
                    receiptMutation.isSuccess &&
                    receiptMutation.variables?.productId === line.product.id
                  }
                  onSubmit={(payload) =>
                    receiptMutation.mutate({ shopId, productId: line.product.id, ...payload })
                  }
                />
                <Link
                  to={`/shops/${shopId}/products/${line.product.id}/daily-report`}
                  className="mt-2 block rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700"
                >
                  Submit daily report
                </Link>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
