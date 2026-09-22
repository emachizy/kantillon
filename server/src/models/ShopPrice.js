import mongoose from 'mongoose';

const { Schema } = mongoose;

// Prices are never updated in place. Changing a price means closing out the
// current row (setting effectiveTo) and inserting a new one — a later phase
// will add a service function for this; Phase 1 only reads prices. The
// partial unique index below (one active row per shop/product) is what
// keeps that invariant enforceable once writes exist.
const shopPriceSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    price: { type: Number, required: true, min: [0.01, 'Price must be positive'] },
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
