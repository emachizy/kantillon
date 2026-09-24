import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchShopInventory, createOpeningStock } from '../api/inventory.js';
import { submitStockReceipt } from '../api/stockReceipts.js';
import { ShopStaffSection } from '../components/ShopStaffSection.jsx';

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
    <form onSubmit={handleSubmit} className="space-y-2">
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
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}

// Two side-by-side (stacked on very narrow screens) cards for the daily,
// per-product actions staff actually do in a shop — kept visually separate
// from any future shop-management navigation. "Receive Stock" reveals the
// existing stock-receipt form in place (no new route); "Daily Report"
// navigates to the existing daily-report route, unchanged.
function QuickActions({ shopId, product, isReceiptOpen, onToggleReceipt }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Quick actions</h3>
      <div className="flex flex-col gap-2 min-[360px]:flex-row">
        <button
          type="button"
          onClick={onToggleReceipt}
          aria-expanded={isReceiptOpen}
          className={`flex-1 rounded-xl border p-3 text-left shadow-sm transition active:bg-slate-50 ${
            isReceiptOpen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'
          }`}
        >
          <p className={`text-sm font-semibold ${isReceiptOpen ? 'text-white' : 'text-slate-900'}`}>
            Receive Stock
          </p>
          <p className={`text-xs ${isReceiptOpen ? 'text-slate-300' : 'text-slate-500'}`}>Record a delivery</p>
        </button>

        <Link
          to={`/shops/${shopId}/products/${product.id}/daily-report`}
          className="flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition active:bg-slate-50"
        >
          <p className="text-sm font-semibold text-slate-900">Daily Report</p>
          <p className="text-xs text-slate-500">Record today&apos;s sales &amp; closing count</p>
        </Link>
      </div>
    </div>
  );
}

export function ShopInventoryPage() {
  const { shopId } = useParams();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [openReceiptProductId, setOpenReceiptProductId] = useState(null);

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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'shop', shopId] });
      queryClient.invalidateQueries({ queryKey: ['stockReceipts'] });
      // Collapse the form back to its quick-action card once submitted.
      if (variables?.productId === openReceiptProductId) setOpenReceiptProductId(null);
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
  const singleLine = inventory.length === 1 ? inventory[0] : null;

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-block text-sm text-slate-500">
        ← Shops
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">{shop.name}</h1>
        {isOwner && (
          <Link to={`/shops/manage/${shopId}`} className="text-xs font-medium text-slate-500">
            Manage shop details →
          </Link>
        )}
      </div>

      {singleLine && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Current Stock</p>
          <p className="text-lg font-semibold text-slate-900">
            {singleLine.balance} {singleLine.product.unit}
          </p>
        </div>
      )}

      {inventory.length === 0 && (
        <div className="space-y-1 text-sm text-slate-500">
          <p>No products configured yet.</p>
          {isOwner ? (
            <Link to="/products/manage/new" className="inline-block font-medium text-slate-600 underline">
              Create Product
            </Link>
          ) : (
            <p>Contact the owner.</p>
          )}
        </div>
      )}

      <div className="space-y-5">
        {inventory.map((line) => (
          <div key={line.product.id} className="space-y-2">
            {!singleLine && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{line.product.name}</span>
                <span className="text-sm text-slate-700">
                  {line.balance} {line.product.unit}
                </span>
              </div>
            )}

            {isOwner && !line.initialized && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
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
              </div>
            )}

            {!isOwner && (
              <>
                <QuickActions
                  shopId={shopId}
                  product={line.product}
                  isReceiptOpen={openReceiptProductId === line.product.id}
                  onToggleReceipt={() =>
                    setOpenReceiptProductId(openReceiptProductId === line.product.id ? null : line.product.id)
                  }
                />
                {openReceiptProductId === line.product.id && (
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
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
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {isOwner && <ShopStaffSection shopId={shopId} />}
    </div>
  );
}
