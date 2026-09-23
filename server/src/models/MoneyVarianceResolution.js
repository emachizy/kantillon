import mongoose from 'mongoose';
import { MONEY_VARIANCE_RESOLUTION_TYPE_VALUES, VARIANCE_RESOLUTION_STATUS_VALUES } from '../utils/constants.js';
import { isSafeMoneyInteger } from '../utils/money.js';

const { Schema } = mongoose;

// An owner-posted accountability record explaining a REAL money
// discrepancy (short/excess collection) found after a DailySalesReport.
// This is deliberately NOT a cash ledger and NEVER creates an
// InventoryTransaction — see services/moneyVarianceResolutionService.js.
// Never edited once created; a mistake is undone via /reverse, which marks
// this REVERSED and reopens the remaining unresolved amount.
const moneyVarianceResolutionSchema = new Schema(
  {
    dailySalesReportId: { type: Schema.Types.ObjectId, ref: 'DailySalesReport', required: true },
    dailySalesCorrectionId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySalesCorrection',
      default: null,
    },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    sourceBusinessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    resolutionType: { type: String, enum: MONEY_VARIANCE_RESOLUTION_TYPE_VALUES, required: true },
    amountKobo: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoneyInteger(v) && v > 0,
        message: 'amountKobo must be a positive safe integer',
      },
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 500 },
    // Defaults to PROCESSING, never ACTIVE — see the equivalent comment on
    // StockVarianceResolution.js.
    status: { type: String, enum: VARIANCE_RESOLUTION_STATUS_VALUES, default: 'PROCESSING' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedAt: { type: Date, required: true, default: Date.now },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, trim: true },
  },
  { timestamps: true }
);

moneyVarianceResolutionSchema.index({ dailySalesReportId: 1, status: 1, createdAt: -1 });
moneyVarianceResolutionSchema.index({ shopId: 1 });

export const MoneyVarianceResolution = mongoose.model(
  'MoneyVarianceResolution',
  moneyVarianceResolutionSchema
);
