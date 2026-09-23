import mongoose from 'mongoose';
import {
  STOCK_VARIANCE_RESOLUTION_TYPE_VALUES,
  INVENTORY_DIRECTION_VALUES,
  VARIANCE_RESOLUTION_STATUS_VALUES,
} from '../utils/constants.js';

const { Schema } = mongoose;

// An owner-posted explanation for a REAL physical stock discrepancy found
// after a DailySalesReport (DAMAGE/SHORTAGE/SURPLUS) — never a correction to
// the report itself (that's DailyReportCorrectionRequest). Each ACTIVE
// resolution also posts exactly one APPROVED InventoryTransaction so the
// official ledger balance catches up with reality; see
// services/stockVarianceResolutionService.js for the remaining-variance
// math and postingBusinessDate rules. Never edited once created — a mistake
// is undone via the /reverse endpoint, which posts an opposing ledger
// transaction and marks this REVERSED, preserving full history.
//
// inventoryTransactionId is nullable+set-after-create (not required at
// creation time) because the resolution and its ledger transaction are
// created together — see the service for how the chicken-and-egg is
// avoided by pre-generating this document's _id.
const stockVarianceResolutionSchema = new Schema(
  {
    dailySalesReportId: { type: Schema.Types.ObjectId, ref: 'DailySalesReport', required: true },
    // Identifies which version (original report or a specific correction)
    // this resolution was posted against — null means the original report.
    dailySalesCorrectionId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySalesCorrection',
      default: null,
    },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sourceBusinessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    resolutionType: { type: String, enum: STOCK_VARIANCE_RESOLUTION_TYPE_VALUES, required: true },
    quantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v) && v > 0, message: 'quantity must be a positive integer' },
    },
    direction: { type: String, enum: INVENTORY_DIRECTION_VALUES, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 500 },
    // Defaults to PROCESSING, never ACTIVE — a resolution is only ACTUALLY
    // resolved once its ledger effect is posted and the coordination
    // state's reservation has been moved to active (see
    // services/stockVarianceResolutionService.js). PROCESSING is not
    // reversible through the normal /reverse endpoint (only ACTIVE is) and
    // must never be presented to a user as resolved.
    status: { type: String, enum: VARIANCE_RESOLUTION_STATUS_VALUES, default: 'PROCESSING' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedAt: { type: Date, required: true, default: Date.now },
    inventoryTransactionId: { type: Schema.Types.ObjectId, ref: 'InventoryTransaction', default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, trim: true },
    reversalInventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
    // The business date the adjustment InventoryTransaction was actually
    // posted on — may differ from sourceBusinessDate; see
    // services/dailySalesReportService.js resolvePostingBusinessDate().
    postingBusinessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  },
  { timestamps: true }
);

stockVarianceResolutionSchema.index({ dailySalesReportId: 1, status: 1, createdAt: -1 });
stockVarianceResolutionSchema.index({ shopId: 1, productId: 1 });

export const StockVarianceResolution = mongoose.model(
  'StockVarianceResolution',
  stockVarianceResolutionSchema
);
