import mongoose from 'mongoose';
import { DAILY_SALES_REPORT_STATUS_VALUES } from '../utils/constants.js';
import { isSafeMoneyInteger } from '../utils/money.js';

const { Schema } = mongoose;

const nonNegativeSafeInteger = (v) => Number.isSafeInteger(v) && v >= 0;
const positiveInteger = (v) => Number.isSafeInteger(v) && v > 0;

const salesLineSchema = new Schema(
  {
    quantity: {
      type: Number,
      required: true,
      validate: { validator: positiveInteger, message: 'quantity must be a positive integer' },
    },
    unitPriceKobo: {
      type: Number,
      required: true,
      validate: {
        validator: (v) => isSafeMoneyInteger(v) && v > 0,
        message: 'unitPriceKobo must be a positive safe integer',
      },
    },
    // Stored, not recomputed on read — this is the historical source of
    // truth for that line's revenue. Changing ShopPrice tomorrow must never
    // alter what this line says happened today.
    lineRevenueKobo: {
      type: Number,
      required: true,
      validate: { validator: isSafeMoneyInteger, message: 'lineRevenueKobo must be a safe integer' },
    },
  },
  { _id: false }
);

// A staff-submitted, immutable end-of-day reconciliation snapshot for one
// shop/product/business-day. This is NOT the authoritative stock ledger —
// InventoryTransaction remains that (see the linked SALE row via
// saleInventoryTransactionId) — this document exists to answer "were the
// bags and the money consistent with what should have been there" and to
// preserve exactly what was reported, permanently. See
// services/dailySalesReportService.js for the calculation rules and
// services/auditService.js / AUDIT_ACTIONS.DAILY_SALES_REPORT_SUBMITTED.
const dailySalesReportSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // Africa/Lagos business day this report closes — see
    // utils/businessDate.js. Submitting a report for shopId+productId+
    // businessDate closes that business day (see
    // dailySalesReportService.js "closed business date" rules).
    businessDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    salesLines: {
      type: [salesLineSchema],
      required: true,
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length >= 1 && lines.length <= 20,
        message: 'salesLines must contain between 1 and 20 lines',
      },
    },
    openingStockQuantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v), message: 'must be a safe integer' },
    },
    approvedStockReceivedQuantity: {
      type: Number,
      required: true,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    availableStockQuantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v), message: 'must be a safe integer' },
    },
    totalQuantitySold: {
      type: Number,
      required: true,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    expectedClosingStockQuantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v), message: 'must be a safe integer' },
    },
    physicalClosingStockQuantity: {
      type: Number,
      required: true,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    // physicalClosingStockQuantity - expectedClosingStockQuantity. Negative
    // = shortage, positive = surplus, zero = balanced. This NEVER feeds
    // back into the ledger — see README "physical count vs ledger".
    stockVarianceQuantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v), message: 'must be a safe integer' },
    },
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
    // actualAmountCollectedKobo - expectedRevenueKobo. Negative = short,
    // positive = excess collected, zero = balanced.
    moneyVarianceKobo: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v), message: 'must be a safe integer' },
    },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, required: true, default: Date.now },
    saleInventoryTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
    notes: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: DAILY_SALES_REPORT_STATUS_VALUES,
      default: 'SUBMITTED',
    },
  },
  { timestamps: true }
);

// Genuinely immutable after submission — nothing on this schema is ever
// updated after creation. Phase 4 variance-resolution "remaining" tracking
// lives entirely on the separate DailyReportResolutionState coordination
// document (see that model's comment for why), never here. Do not add a
// mutable field to this schema without a very strong reason.

// At most one submitted report per shop/product/business-day, enforced at
// the database level (not just an app-level pre-check) — see
// dailySalesReportService.js for the concurrent-submission handling this
// makes possible.
dailySalesReportSchema.index({ shopId: 1, productId: 1, businessDate: 1 }, { unique: true });

export const DailySalesReport = mongoose.model('DailySalesReport', dailySalesReportSchema);
