import mongoose from 'mongoose';
import { CORRECTION_REQUEST_STATUS_VALUES } from '../utils/constants.js';
import { isSafeMoneyInteger } from '../utils/money.js';

const { Schema } = mongoose;

const proposedSalesLineSchema = new Schema(
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
  },
  { _id: false }
);

// A staff-submitted request to correct a mistake in an already-submitted
// DailySalesReport ("the salesperson entered the wrong information") — as
// opposed to a StockVarianceResolution/MoneyVarianceResolution, which
// records a genuine real-world discrepancy against an accurate report. The
// proposed values are the COMPLETE corrected report state (not a partial
// patch), so review is explicit and deterministic — see
// services/dailyReportCorrectionService.js.
const dailyReportCorrectionRequestSchema = new Schema(
  {
    dailySalesReportId: { type: Schema.Types.ObjectId, ref: 'DailySalesReport', required: true },
    shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    proposedSalesLines: {
      type: [proposedSalesLineSchema],
      required: true,
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length >= 1 && lines.length <= 20,
        message: 'proposedSalesLines must contain between 1 and 20 lines',
      },
    },
    proposedPhysicalClosingStockQuantity: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v) && v >= 0, message: 'must be a non-negative integer' },
    },
    proposedActualAmountCollectedKobo: {
      type: Number,
      required: true,
      validate: { validator: (v) => isSafeMoneyInteger(v), message: 'must be a non-negative safe integer' },
    },
    proposedNotes: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: CORRECTION_REQUEST_STATUS_VALUES,
      default: 'PENDING',
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true },
    approvedCorrectionId: { type: Schema.Types.ObjectId, ref: 'DailySalesCorrection', default: null },
  },
  { timestamps: true }
);

dailyReportCorrectionRequestSchema.index({ shopId: 1, status: 1, createdAt: -1 });
dailyReportCorrectionRequestSchema.index({ dailySalesReportId: 1, createdAt: -1 });

// Only one PENDING-or-PROCESSING (i.e. not yet terminal) correction request
// may exist for a report at a time — enforced at the database level, not
// just an app-level pre-check. PROCESSING is included so a new request
// can't be created for a report while a previous one is mid-approval.
dailyReportCorrectionRequestSchema.index(
  { dailySalesReportId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'PROCESSING'] } } }
);

export const DailyReportCorrectionRequest = mongoose.model(
  'DailyReportCorrectionRequest',
  dailyReportCorrectionRequestSchema
);
