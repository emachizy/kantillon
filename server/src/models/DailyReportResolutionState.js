import mongoose from 'mongoose';

const { Schema } = mongoose;

const nonNegativeSafeInteger = (v) => Number.isSafeInteger(v) && v >= 0;

// SOURCE-OF-TRUTH HIERARCHY (see README "Source-of-truth hierarchy"):
//   1. OFFICIAL INVENTORY TRUTH        — InventoryTransaction
//   2. COMPLETED STOCK RESOLUTION TRUTH — StockVarianceResolution, status ACTIVE
//   3. COMPLETED MONEY RESOLUTION TRUTH — MoneyVarianceResolution, status ACTIVE
//   4. CONCURRENCY/RESERVATION COORDINATION — THIS document.
//
// This document is NOT the historical record of what was resolved, and
// never writes to DailySalesReport, which must remain a permanent,
// immutable historical snapshot. DailySalesCorrection is likewise never
// touched by this document. It exists ONLY to:
//   - prevent concurrent over-resolution (the atomic
//     reserved+active+requested <= |variance| check),
//   - reserve in-flight magnitude while a resolution is PROCESSING,
//   - coordinate active+reserved capacity across concurrent requests,
//   - expose diagnostic PROCESSING/reserved amounts.
//
// Each variance tracks TWO separate counters, never merged into one:
//   - reserved*: claimed by an in-flight (PROCESSING) resolution attempt.
//     Concurrency-only. NOT a completed resolution and must never be shown
//     to a user as resolved.
//   - active*: a CACHE that should mirror the sum of ACTIVE
//     StockVarianceResolution / MoneyVarianceResolution documents for the
//     current effective version. It is NOT itself the business-truth
//     record — that is always the real ACTIVE documents, aggregated fresh
//     by dailyReportCorrectionService.js getActiveStockResolutionMagnitude()
//     / getActiveMoneyResolutionMagnitude(), which is what
//     getEffectiveDailyReport() actually displays. If this cache ever
//     disagrees with the true ACTIVE-document sum, that's a divergence to
//     log and reconcile manually, never a reason to silently rewrite
//     resolution records or to trust the cache over the real documents.
// A resolution attempt increments reserved* first (the atomic concurrency
// gate), then creates its ledger effect (stock only) and marks its own
// document ACTIVE — that write is what makes it business-truth-real — and
// only THEN, as a best-effort bookkeeping step, moves that same amount
// from reserved* to active*. See services/stockVarianceResolutionService.js
// / moneyVarianceResolutionService.js for exactly why that ordering (mark
// ACTIVE before touching the cache) is the crash-safer choice. Reversing an
// ACTIVE resolution decrements active* directly; reserved* is never
// touched by a reversal.
//
// effectiveCorrectionId records WHICH version (the original report, or a
// specific approved DailySalesCorrection) these counters are currently
// tracking. A correction can only be approved while ALL four counters are
// zero (dailyReportCorrectionService.hasAnyResolutionActivity), so
// effectiveCorrectionId only ever changes when there is nothing to lose.
// If it were ever asked to change while a counter is non-zero, that is a
// FAIL-CLOSED error, not a reset — see
// services/dailyReportResolutionStateService.js
// syncResolutionStateToEffectiveVersion().
//
// correctionProcessing / correctionProcessingRequestId close a race the
// counters alone cannot: "correction checks zero resolution activity" ->
// "a stock/money resolution reserves against the still-current version" ->
// "correction becomes effective" (which would silently strand that
// resolution's reservation against a version nobody resolves against
// anymore). A correction approval must atomically CLAIM this lock (only
// when effectiveCorrectionId matches, the lock is free, and all four
// counters are zero) BEFORE building its ledger effects, and every stock/
// money reservation's atomic filter must require correctionProcessing ===
// false in the SAME findOneAndUpdate that reserves magnitude — see
// services/dailyReportResolutionStateService.js claimCorrectionProcessingLock()
// and services/stockVarianceResolutionService.js /
// moneyVarianceResolutionService.js.
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
    // The correction/resolution shared lock — see the comment above.
    correctionProcessing: { type: Boolean, default: false },
    correctionProcessingRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'DailyReportCorrectionRequest',
      default: null,
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
