import mongoose from 'mongoose';
import { isSafeMoneyInteger } from '../utils/money.js';

const { Schema } = mongoose;

// Prices are never updated in place. Changing a price means closing out the
// current row (setting effectiveTo) and inserting a new one — a later phase
// will add a service function for this; Phase 1 only reads prices. The
// partial unique index below (one active row per shop/product) is what
// keeps that invariant enforceable once writes exist.
//
// Price is stored as integer kobo (1 Naira = 100 kobo), never a
// floating-point Naira value — see utils/money.js. This field was
// originally named `price` (a plain Naira Number); it was renamed to
// `priceKobo` before this system went to production specifically so there
// would never be two competing authoritative price representations. See
// migrations/2026-09-shopprice-price-to-kobo.js for the one-time backfill
// of pre-existing development data.
const shopPriceSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    priceKobo: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoneyInteger(v) && v > 0,
        message: 'priceKobo must be a positive safe integer',
      },
    },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    // null effectiveTo means this is the currently active price.
    effectiveTo: { type: Date, default: null },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

shopPriceSchema.index({ shopId: 1, productId: 1, effectiveFrom: -1 });

// Only one currently-active (effectiveTo: null) price per shop/product.
shopPriceSchema.index(
  { shopId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { effectiveTo: null } }
);

export const ShopPrice = mongoose.model('ShopPrice', shopPriceSchema);
