import { useState } from 'react';
import { formatKoboAsNaira, nairaInputToKobo } from '../utils/money.js';

function errorMessage(error, fallback) {
  const details = error?.response?.data?.details;
  if (Array.isArray(details) && details.length) return details[0].message;
  return error?.response?.data?.message || fallback;
}

// One row: a label (shop name or product name, depending on which page
// renders it), its current price (or "Not configured"), and an inline
// change form. Shared by ManageProductPage (one product, every shop) and
// ManageShopPage (one shop, every product) so there is exactly one
// set-price UI writing through the same setShopPrice mutation, never two.
export function ShopPriceRow({ label, priceKobo, onSave, isPending, error }) {
  const [isEditing, setIsEditing] = useState(false);
  const [nairaInput, setNairaInput] = useState('');
  const [localError, setLocalError] = useState(null);

  function handleSave(e) {
    e.preventDefault();
    let kobo;
    try {
      kobo = nairaInputToKobo(nairaInput);
    } catch {
      setLocalError('Enter a valid amount, e.g. 12000 or 12000.50');
      return;
    }
    if (kobo <= 0) {
      setLocalError('Price must be greater than zero');
      return;
    }
    setLocalError(null);
    onSave(kobo, () => {
      setIsEditing(false);
      setNairaInput('');
    });
  }

  return (
    <div className="border-b border-slate-100 py-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">
            {priceKobo != null ? formatKoboAsNaira(priceKobo) : 'Not configured'}
          </p>
        </div>

        {isEditing ? (
          <form onSubmit={handleSave} className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              placeholder="Naira"
              value={nairaInput}
              onChange={(e) => setNairaInput(e.target.value)}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setLocalError(null);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="shrink-0 text-xs font-medium text-slate-500"
          >
            {priceKobo != null ? 'Change Price' : 'Set Price'}
          </button>
        )}
      </div>

      {(localError || error) && (
        <p className="mt-1 text-xs text-red-600">{localError || errorMessage(error, 'Could not save price.')}</p>
      )}
    </div>
  );
}
