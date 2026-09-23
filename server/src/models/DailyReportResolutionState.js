import mongoose from 'mongoose';

const { Schema } = mongoose;

const nonNegativeSafeInteger = (v) => Number.isSafeInteger(v) && v >= 0;

// Purely a concurrency-coordination document — it exists ONLY so
// stock/money variance resolutions can atomically reserve against a
// report's remaining variance without ever writing to DailySalesReport,
// which must remain a permanent, immutable historical snapshot (see
// README "DailySalesReport immutability"). DailySalesCorrection is
// likewise never touched by this document.
//
// Each variance tracks TWO separate counters, never merged into one:
//   - reserved*: claimed by an in-flight (PROCESSING) resolution attempt.
//     Exists only to prevent concurrent over-resolution — a reservation is
//     NOT a completed resolution and must never be shown to a user as
//     resolved.
//   - active*: backed by a real, completed StockVarianceResolution /
//     MoneyVarianceResolution document with status ACTIVE. This is the
//     ONLY number that means "actually resolved" — see
//     dailyReportResolutionStateService.getActiveMagnitudes(), which is
//     what user-facing "remaining variance" is computed from.
// A resolution attempt increments reserved* first (the atomic concurrency
// gate checks reserved+active+requested <= |variance|), then — once its
// ledger effect (if any) is safely posted — atomically moves that same
// amount from reserved* to active* and only THEN flips its own document to
// ACTIVE. Reversing an ACTIVE resolution decrements active* directly;
// reserved* is never touched by a reversal (see
// services/stockVarianceResolutionService.js / moneyVarianceResolutionService.js).
//
// effectiveCorrectionId records WHICH version (the original report, or a
// specific approved DailySalesCorrection) these counters are currently
// tracking. A correction can only be approved while ALL four counters are
// zero (dailyReportCorrectionService.hasActiveVarianceResolutions), so
// effectiveCorrectionId only ever changes when there is nothing to lose —
// see services/dailyReportResolutionStateService.js
// syncResolutionStateToEffectiveVersion() for the defensive reset this
// still performs if that invariant were ever violated.
const dailyReportResolutionStateSchema = new Schema(
  {
    dailySalesReportId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySalesReport',
      required: true,
      unique: true,
    },
    effectiveCorrectionId: {
      type: Schema.Types.ObjectId,
      ref: 'DailySalesCorrection',
      default: null,
    },
    reservedStockVarianceMagnitude: {
      type: Number,
      default: 0,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    activeStockVarianceMagnitude: {
      type: Number,
      default: 0,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    reservedMoneyVarianceMagnitudeKobo: {
      type: Number,
      default: 0,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    activeMoneyVarianceMagnitudeKobo: {
      type: Number,
      default: 0,
      validate: { validator: nonNegativeSafeInteger, message: 'must be a non-negative integer' },
    },
    // Bumped on every mutation — a cheap diagnostic trail for reviewing how
    // many reservation/completion/reversal events a report's coordination
    // state has been through; not used for optimistic-concurrency control
    // (the atomic $expr-bounded $inc already provides the real correctness
    // guarantee).
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const DailyReportResolutionState = mongoose.model(
  'DailyReportResolutionState',
  dailyReportResolutionStateSchema
);
