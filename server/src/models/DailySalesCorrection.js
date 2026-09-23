import mongoose from 'mongoose';
import { isSafeMoneyInteger } from '../utils/money.js';

const { Schema } = mongoose;

const nonNegativeSafeInteger = (v) => Number.isSafeInteger(v) && v >= 0;

const salesLineSchema = new Schema(
  {
    quantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v) && v > 0, message: 'quantity must be a positive integer' },
    },
    unitPriceKobo: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoneyInteger(v) && v > 0,
        message: 'unitPriceKobo must be a positive safe integer',
      },
    },
    lineRevenueKobo: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoneyInteger, message: 'lineRevenueKobo must be a safe integer' },
    },
  },
  { _id: false }
);

// An immutable, approved correction snapshot for a DailySalesReport. Once
// created, never edited or deleted — a further correction creates a NEW
// DailySalesCorrection with supersedesCorrectionId pointing back to this
// one. The latest one (by correctionNumber) for a report is the "effective"
// version everywhere except the original report's own immutable fields —
// see services/dailyReportCorrectionService.js getEffectiveDailyReport().
const dailySalesCorrectionSchema = new Schema(
  {
    dailySalesReportId: { type: Schema.Types.ObjectId, ref: 'DailySalesReport', required: true },
    correctionRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'DailyReportCorrectionRequest',
      required: true,
    },
    correctionNumber: { type: Number, required: true, min: 1 },
    supersedesCorrectionId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySalesCorrection',
      default: null,
    },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    salesLines: {
      type: [salesLineSchema],
      required: true,
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length >= 1 && lines.length <= 20,
        message: 'salesLines must contain between 1 and 20 lines',
      },
    },
    // Historical inventory context, copied unchanged from the original
    // DailySalesReport — never recalculated from today's ledger. See
    // services/dailyReportCorrectionService.js "historical base".
    openingStockQuantity: { type: Number, required: true },
    approvedStockReceivedQuantity: { type: Number, required: true, validate: nonNegativeSafeInteger },
    availableStockQuantity: { type: Number, required: true },
    totalQuantitySold: { type: Number, required: true, validate: nonNegativeSafeInteger },
    expectedClosingStockQuantity: { type: Number, required: true },
    physicalClosingStockQuantity: { type: Number, required: true, validate: nonNegativeSafeInteger },
    stockVarianceQuantity: { type: Number, required: true },
    expectedRevenueKobo: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoneyInteger, message: 'must be a safe integer' },
    },
    actualAmountCollectedKobo: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoneyInteger, message: 'must be a safe integer' },
    },
    moneyVarianceKobo: { type: Number, required: true },
    notes: { type: String, trim: true, maxlength: 500 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedAt: { type: Date, required: true, default: Date.now },
    // Null when totalQuantitySold didn't change from the previously
    // effective quantity (price/physical/money-only correction) — see
    // "correction with same quantity" in the README.
    reversalInventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
    replacementSaleInventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
    // Always set — either the newly-created replacement SALE above, or (for
    // a same-quantity correction) whatever was already effective before
    // this correction. This is what the NEXT correction reverses.
    effectiveSaleInventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      required: true,
    },
  },
  { timestamps: true }
);

dailySalesCorrectionSchema.index({ dailySalesReportId: 1, correctionNumber: -1 });

// At most one correction per (report, correctionNumber) — belt-and-suspenders
// alongside the atomic correction-request approval gate.
dailySalesCorrectionSchema.index(
  { dailySalesReportId: 1, correctionNumber: 1 },
  { unique: true }
);

export const DailySalesCorrection = mongoose.model('DailySalesCorrection', dailySalesCorrectionSchema);
