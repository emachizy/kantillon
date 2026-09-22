import mongoose from 'mongoose';
import {
  INVENTORY_TRANSACTION_TYPE_VALUES,
  INVENTORY_DIRECTION_VALUES,
  INVENTORY_TRANSACTION_STATUS_VALUES,
  REFERENCE_TYPE_VALUES,
} from '../utils/constants.js';

const { Schema } = mongoose;

// Append-only stock ledger. This is the single source of truth for inventory;
// Shop/Product must never carry a mutable "currentStock" field. A shop's
// balance is always derived by summing APPROVED transactions
// (IN quantities minus OUT quantities). Corrections happen via a new
// REVERSAL transaction referencing the original, never by editing history.
const inventoryTransactionSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: INVENTORY_TRANSACTION_TYPE_VALUES, required: true },
    quantity: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'Quantity must be a positive number',
      },
    },
    direction: { type: String, enum: INVENTORY_DIRECTION_VALUES, required: true },
    referenceType: { type: String, enum: REFERENCE_TYPE_VALUES, default: 'MANUAL' },
    referenceId: { type: Schema.Types.ObjectId, default: null },
    status: {
      type: String,
      enum: INVENTORY_TRANSACTION_STATUS_VALUES,
      default: 'PENDING',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
    // The business day this movement belongs to (Africa/Lagos, "YYYY-MM-DD")
    // — NOT createdAt, which is a UTC wall-clock timestamp and says nothing
    // about which business day a movement should be attributed to. Required
    // for every new transaction; pre-Phase-3 documents are backfilled by
    // migrations/2026-09-business-date-backfill.js.
    businessDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
  },
  { timestamps: true }
);

// Ledger queries are almost always "give me this shop+product's movements".
inventoryTransactionSchema.index({ shopId: 1, productId: 1, status: 1, createdAt: -1 });
inventoryTransactionSchema.index({ referenceType: 1, referenceId: 1 });
// Daily reconciliation queries filter by exactly this combination.
inventoryTransactionSchema.index({ shopId: 1, productId: 1, businessDate: 1, status: 1 });

// Opening stock is a one-time initialization, not a correction mechanism —
// at most one OPENING_STOCK transaction may ever exist per shop/product.
// Enforced at the database level (not just an app-level pre-check) so a
// race between two concurrent requests can't create two, since Phase 2
// always inserts OPENING_STOCK directly as APPROVED (never PENDING/REJECTED).
inventoryTransactionSchema.index(
  { shopId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { type: 'OPENING_STOCK' } }
);

export const InventoryTransaction = mongoose.model(
  'InventoryTransaction',
  inventoryTransactionSchema
);
