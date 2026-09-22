import mongoose from 'mongoose';
import { STOCK_RECEIPT_STATUS_VALUES } from '../utils/constants.js';

const { Schema } = mongoose;

// A staff-submitted "stock arrived" report. It starts PENDING and only
// affects official inventory once an OWNER approves it — see
// services/stockReceiptService.js. The linked InventoryTransaction (created
// alongside this document) is the actual source of truth for stock; this
// model exists to carry the human workflow metadata (who reported it, who
// approved/rejected it, why) that doesn't belong on the ledger row itself.
const stockReceiptSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'Quantity must be a positive number',
      },
    },
    deliveryReference: { type: String, trim: true },
    notes: { type: String, trim: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    // The business day this receipt is reported against (Africa/Lagos,
    // "YYYY-MM-DD"), independent of receivedAt's UTC timestamp. Defaults to
    // today's Lagos business date if the client omits it; always validated
    // server-side (future dates and already-closed business days are
    // rejected — see services/stockReceiptService.js). Pre-Phase-3
    // documents are backfilled by
    // migrations/2026-09-business-date-backfill.js.
    businessDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: {
      type: String,
      enum: STOCK_RECEIPT_STATUS_VALUES,
      default: 'PENDING',
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true },
    inventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
  },
  { timestamps: true }
);

stockReceiptSchema.index({ shopId: 1, status: 1, createdAt: -1 });
stockReceiptSchema.index({ productId: 1 });
stockReceiptSchema.index({ shopId: 1, productId: 1, businessDate: 1, status: 1 });

export const StockReceipt = mongoose.model('StockReceipt', stockReceiptSchema);
