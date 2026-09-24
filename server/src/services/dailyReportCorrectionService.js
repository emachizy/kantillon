import mongoose from 'mongoose';
import { DailySalesReport } from '../models/DailySalesReport.js';
import { DailyReportCorrectionRequest } from '../models/DailyReportCorrectionRequest.js';
import { DailySalesCorrection } from '../models/DailySalesCorrection.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { StockVarianceResolution } from '../models/StockVarianceResolution.js';
import { MoneyVarianceResolution } from '../models/MoneyVarianceResolution.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';
import { computeRemainingSigned } from '../utils/variance.js';
import {
  getActiveMagnitudes,
  hasAnyResolutionActivity,
  claimCorrectionProcessingLock,
  releaseCorrectionProcessingLockOnFailure,
  releaseCorrectionProcessingLockWithNewVersion,
} from './dailyReportResolutionStateService.js';

const REQUEST_POPULATE = [
  { path: 'shopId', select: 'name code' },
  { path: 'productId', select: 'name sku unit' },
  { path: 'requestedBy', select: 'name role' },
  { path: 'reviewedBy', select: 'name role' },
];

const CORRECTION_POPULATE = [
  { path: 'shopId', select: 'name code' },
  { path: 'productId', select: 'name sku unit' },
  { path: 'approvedBy', select: 'name role' },
];

// The latest APPROVED correction for a report, or null if none exists yet.
// A rejected request never produces a DailySalesCorrection at all, so a
// rejected correction can never become effective — no extra filtering
// needed here.
export async function getLatestApprovedCorrection(reportId) {
  return DailySalesCorrection.findOne({ dailySalesReportId: reportId }).sort({ correctionNumber: -1 });
}

// "What is currently the effective SALE ledger effect for this report" —
// the thing a NEW correction's quantity change must reverse. Correction #2
// must reverse Correction #1's effective sale, not the original, so this
// always looks at the latest approved correction first.
async function getEffectiveSaleInfo(report) {
  const latest = await getLatestApprovedCorrection(report._id);
  if (latest) {
    return { saleTransactionId: latest.effectiveSaleInventoryTransactionId, quantity: latest.totalQuantitySold };
  }
  return { saleTransactionId: report.saleInventoryTransactionId, quantity: report.totalQuantitySold };
}

function computeCorrectedValues(report, proposedSalesLines, proposedPhysicalClosingStockQuantity, proposedActualAmountCollectedKobo) {
  const computedSalesLines = proposedSalesLines.map(({ quantity, unitPriceKobo }) => {
    const lineRevenueKobo = quantity * unitPriceKobo;
    if (!Number.isSafeInteger(lineRevenueKobo)) {
      throw ApiError.badRequest('A sales line revenue calculation exceeded safe integer range');
    }
    return { quantity, unitPriceKobo, lineRevenueKobo };
  });

  const totalQuantitySold = computedSalesLines.reduce((sum, l) => sum + l.quantity, 0);
  const expectedRevenueKobo = computedSalesLines.reduce((sum, l) => sum + l.lineRevenueKobo, 0);
  if (!Number.isSafeInteger(totalQuantitySold) || !Number.isSafeInteger(expectedRevenueKobo)) {
    throw ApiError.badRequest('Sales totals exceeded safe integer range');
  }

  // Historical base — ALWAYS the original report's stored context, never
  // recalculated from today's ledger. This is what "correction of a
  // correction" still gets right: opening/received stock for that business
  // date is a fixed historical fact.
  const availableStockQuantity = report.availableStockQuantity;
  if (totalQuantitySold > availableStockQuantity) {
    throw ApiError.conflict(
      `Corrected sales (${totalQuantitySold}) exceed the historical available stock ` +
        `(${availableStockQuantity}) recorded for this business date`
    );
  }

  const expectedClosingStockQuantity = availableStockQuantity - totalQuantitySold;
  const stockVarianceQuantity = proposedPhysicalClosingStockQuantity - expectedClosingStockQuantity;
  const moneyVarianceKobo = proposedActualAmountCollectedKobo - expectedRevenueKobo;

  return {
    computedSalesLines,
    totalQuantitySold,
    expectedRevenueKobo,
    expectedClosingStockQuantity,
    stockVarianceQuantity,
    moneyVarianceKobo,
  };
}

export async function requestCorrection({
  reportId,
  reason,
  proposedSalesLines,
  proposedPhysicalClosingStockQuantity,
  proposedActualAmountCollectedKobo,
  proposedNotes,
  actingUser,
  req,
}) {
  const report = await DailySalesReport.findById(reportId);
  if (!report) throw ApiError.notFound('Daily sales report not found');

  if (await hasAnyResolutionActivity(reportId)) {
    throw ApiError.conflict(
      'Active stock or money variance resolutions already exist for this report; ' +
        'they must be reversed before a new correction can be requested'
    );
  }

  // Friendly pre-check; the partial unique index on {dailySalesReportId}
  // where status is PENDING or PROCESSING is the real, race-proof guard
  // (E11000 below).
  const existingActive = await DailyReportCorrectionRequest.findOne({
    dailySalesReportId: reportId,
    status: { $in: ['PENDING', 'PROCESSING'] },
  });
  if (existingActive) {
    throw ApiError.conflict('A correction request is already pending for this report');
  }

  // Defensive recompute so a malformed/spoofed proposal can't slip through
  // even before approval — same rules as submission, using this report's
  // historical base.
  computeCorrectedValues(
    report,
    proposedSalesLines,
    proposedPhysicalClosingStockQuantity,
    proposedActualAmountCollectedKobo
  );

  let request;
  try {
    request = await DailyReportCorrectionRequest.create({
      dailySalesReportId: reportId,
      shopId: report.shopId,
      productId: report.productId,
      businessDate: report.businessDate,
      requestedBy: actingUser._id,
      reason,
      proposedSalesLines,
      proposedPhysicalClosingStockQuantity,
      proposedActualAmountCollectedKobo,
      proposedNotes,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw ApiError.conflict('A correction request is already pending for this report');
    }
    throw err;
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: report.shopId,
    action: AUDIT_ACTIONS.DAILY_REPORT_CORRECTION_REQUESTED,
    entityType: 'DailyReportCorrectionRequest',
    entityId: request._id,
    newValue: {
      businessDate: report.businessDate,
      reason,
      proposedPhysicalClosingStockQuantity,
      proposedActualAmountCollectedKobo,
    },
  });

  await request.populate(REQUEST_POPULATE);
  return request;
}

export async function listCorrectionRequestsForReport(reportId) {
  return DailyReportCorrectionRequest.find({ dailySalesReportId: reportId })
    .sort({ createdAt: -1 })
    .populate(REQUEST_POPULATE);
}

export async function listPendingCorrectionRequests() {
  return DailyReportCorrectionRequest.find({ status: 'PENDING' })
    .sort({ createdAt: 1 })
    .populate(REQUEST_POPULATE);
}

export async function rejectCorrectionRequest({ id, reason, actingUser, req }) {
  const now = new Date();
  const request = await DailyReportCorrectionRequest.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { status: 'REJECTED', reviewedBy: actingUser._id, reviewedAt: now, rejectionReason: reason },
    { new: true }
  ).populate(REQUEST_POPULATE);

  if (!request) {
    const current = await DailyReportCorrectionRequest.findById(id);
    if (!current) throw ApiError.notFound('Correction request not found');
    throw ApiError.conflict(`Correction request is already ${current.status} and cannot be rejected`);
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: request.shopId._id,
    action: AUDIT_ACTIONS.DAILY_REPORT_CORRECTION_REJECTED,
    entityType: 'DailyReportCorrectionRequest',
    entityId: request._id,
    reason,
  });

  return request;
}

export async function approveCorrectionRequest({ id, actingUser, req }) {
  const now = new Date();

  // Atomic claim — exactly one concurrent approval attempt can win this.
  // PROCESSING (not APPROVED) is the claim state: a crash after this claim
  // but before the correction effects are fully built must never leave a
  // request that LOOKS approved but has no DailySalesCorrection behind it.
  // See README "Correction approval state machine" for the residual
  // standalone-MongoDB limitation this still carries — a hard process
  // crash (not a caught error) while PROCESSING is a recoverable/manual-
  // review state, not something this code can detect and fix automatically.
  const request = await DailyReportCorrectionRequest.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { status: 'PROCESSING', reviewedBy: actingUser._id, reviewedAt: now },
    { new: true }
  );

  if (!request) {
    const current = await DailyReportCorrectionRequest.findById(id);
    if (!current) throw ApiError.notFound('Correction request not found');
    if (current.status === 'PROCESSING') {
      throw ApiError.conflict('Correction request is currently being processed; try again shortly');
    }
    throw ApiError.conflict(`Correction request is already ${current.status} and cannot be approved`);
  }

  // True once claimCorrectionProcessingLock() below actually succeeds — the
  // catch block needs to know whether there's a lock to release. Declared
  // here (outside the try) so the catch block can read it.
  let lockClaimed = false;

  try {
    const report = await DailySalesReport.findById(request.dailySalesReportId);
    if (!report) throw ApiError.internal('The daily sales report linked to this correction no longer exists');

    // Friendly pre-check; the atomic lock claim below is the real,
    // race-proof guard (see the comment on claimCorrectionProcessingLock).
    if (await hasAnyResolutionActivity(report._id)) {
      throw ApiError.conflict(
        'Active stock or money variance resolutions now exist for this report; ' +
          'reverse them first, or reject this request'
      );
    }

    const {
      computedSalesLines,
      totalQuantitySold,
      expectedRevenueKobo,
      expectedClosingStockQuantity,
      stockVarianceQuantity,
      moneyVarianceKobo,
    } = computeCorrectedValues(
      report,
      request.proposedSalesLines,
      request.proposedPhysicalClosingStockQuantity,
      request.proposedActualAmountCollectedKobo
    );

    const previousEffective = await getEffectiveSaleInfo(report);
    const quantityChanged = totalQuantitySold !== previousEffective.quantity;
    const correctionNumber = (await DailySalesCorrection.countDocuments({ dailySalesReportId: report._id })) + 1;
    const previousCorrection = await getLatestApprovedCorrection(report._id);
    const previousEffectiveCorrectionId = previousCorrection?._id ?? null;

    // The real, race-proof guard: atomically claim the shared coordination
    // lock BEFORE building any correction ledger effects. This closes the
    // race where a stock/money resolution reserves against the current
    // effective version between the friendly check above and this
    // correction actually becoming effective. See README "Correction/
    // resolution shared lock".
    await claimCorrectionProcessingLock(report._id, previousEffectiveCorrectionId, request._id);
    lockClaimed = true;

    const result = await runWithOptionalTransaction(async (session) => {
      let createdCorrection;
      let reversalTxn;
      let replacementTxn;
      let finalRequest;
      try {
        [createdCorrection] = await DailySalesCorrection.create(
          [
            {
              dailySalesReportId: report._id,
              correctionRequestId: request._id,
              correctionNumber,
              supersedesCorrectionId: previousCorrection?._id ?? null,
              shopId: report.shopId,
              productId: report.productId,
              businessDate: report.businessDate,
              salesLines: computedSalesLines,
              openingStockQuantity: report.openingStockQuantity,
              approvedStockReceivedQuantity: report.approvedStockReceivedQuantity,
              availableStockQuantity: report.availableStockQuantity,
              totalQuantitySold,
              expectedClosingStockQuantity,
              physicalClosingStockQuantity: request.proposedPhysicalClosingStockQuantity,
              stockVarianceQuantity,
              expectedRevenueKobo,
              actualAmountCollectedKobo: request.proposedActualAmountCollectedKobo,
              moneyVarianceKobo,
              notes: request.proposedNotes,
              approvedBy: actingUser._id,
              approvedAt: now,
              // Placeholder — only correct as-is for the no-quantity-change
              // path; overwritten below when a reversal/replacement is created.
              effectiveSaleInventoryTransactionId: previousEffective.saleTransactionId,
            },
          ],
          { session }
        );

        if (quantityChanged) {
          // Reverse whatever is CURRENTLY effective (the original sale, or
          // the previous correction's replacement) — never the original
          // blindly. See "correction of a correction" in the README.
          [reversalTxn] = await InventoryTransaction.create(
            [
              {
                shopId: report.shopId,
                productId: report.productId,
                type: 'REVERSAL',
                direction: 'IN',
                quantity: previousEffective.quantity,
                referenceType: 'DAILY_REPORT_CORRECTION',
                referenceId: previousEffective.saleTransactionId,
                status: 'APPROVED',
                createdBy: actingUser._id,
                approvedBy: actingUser._id,
                approvedAt: now,
                businessDate: report.businessDate,
                effectKey: `daily-correction:${request._id}:reversal`,
              },
            ],
            { session }
          );

          [replacementTxn] = await InventoryTransaction.create(
            [
              {
                shopId: report.shopId,
                productId: report.productId,
                type: 'SALE',
                direction: 'OUT',
                quantity: totalQuantitySold,
                referenceType: 'DAILY_REPORT_CORRECTION',
                referenceId: createdCorrection._id,
                status: 'APPROVED',
                createdBy: actingUser._id,
                approvedBy: actingUser._id,
                approvedAt: now,
                businessDate: report.businessDate,
                effectKey: `daily-correction:${request._id}:replacement-sale`,
              },
            ],
            { session }
          );

          createdCorrection.reversalInventoryTransactionId = reversalTxn._id;
          createdCorrection.replacementSaleInventoryTransactionId = replacementTxn._id;
          createdCorrection.effectiveSaleInventoryTransactionId = replacementTxn._id;
          await createdCorrection.save({ session });
        }

        // The final PENDING-claim-to-APPROVED transition lives INSIDE this
        // same attempt — on a replica set, it commits or rolls back
        // atomically together with the correction + ledger effects above,
        // eliminating the workflow-divergence window entirely. On our
        // confirmed-standalone MongoDB it is NOT atomic with the writes
        // above (see the catch below, which cleans up everything created
        // in this attempt if this step fails) — we do not fake that
        // guarantee here. Still conditioned on status still being
        // PROCESSING, and we return THIS document, never the stale
        // PROCESSING one captured at claim time — the API must never
        // report PROCESSING as the outcome of a successful approval.
        finalRequest = await DailyReportCorrectionRequest.findOneAndUpdate(
          { _id: request._id, status: 'PROCESSING' },
          { status: 'APPROVED', approvedCorrectionId: createdCorrection._id },
          { new: true, session }
        ).populate(REQUEST_POPULATE);

        if (!finalRequest) {
          // Unreachable in normal operation — we hold the only valid
          // PROCESSING claim. Treat exactly like any other failure in this
          // attempt: on standalone this falls through to the catch below,
          // which cleans up the correction + ledger effects just created
          // (so APPROVED can never exist without them, and nothing is left
          // half-applied); on a replica set the whole transaction rolls
          // back automatically.
          throw ApiError.internal(
            'Correction request workflow state changed unexpectedly during approval ' +
              '(expected PROCESSING).'
          );
        }

        return { correction: createdCorrection, reversalTxn, replacementTxn, request: finalRequest };
      } catch (err) {
        if (session) {
          throw err;
        }

        const cleanupTasks = [];
        if (replacementTxn) cleanupTasks.push(InventoryTransaction.deleteOne({ _id: replacementTxn._id }));
        if (reversalTxn) cleanupTasks.push(InventoryTransaction.deleteOne({ _id: reversalTxn._id }));
        if (createdCorrection) cleanupTasks.push(DailySalesCorrection.deleteOne({ _id: createdCorrection._id }));
        const cleanupResults = cleanupTasks.length ? await Promise.allSettled(cleanupTasks) : [];
        const cleanupFailures = cleanupResults.filter((r) => r.status === 'rejected');

        // eslint-disable-next-line no-console
        console.error('[DAILY_CORRECTION_PARTIAL_FAILURE]', {
          correctionRequestId: request._id,
          reportId: report._id,
          createdCorrectionId: createdCorrection?._id,
          reversalTxnId: reversalTxn?._id,
          replacementTxnId: replacementTxn?._id,
          finalTransitionSucceeded: Boolean(finalRequest),
          originalError: err,
          cleanupAttempted: cleanupTasks.length,
          cleanupFailures: cleanupFailures.length,
        });

        if (cleanupFailures.length) {
          throw ApiError.internal(
            'Failed to approve correction, and cleanup of partially-created data also failed. ' +
              'This requires manual review — see server logs for DAILY_CORRECTION_PARTIAL_FAILURE.'
          );
        }

        throw ApiError.internal(
          'Failed to approve correction consistently; no partial record was retained. Please try again.'
        );
      }
    });

    // At this point the attempt above fully succeeded (correction, ledger
    // effects, and the request's PROCESSING->APPROVED transition together)
    // — nothing left half-applied, so it is always safe to proceed. Release
    // the coordination lock AND switch effectiveCorrectionId to the newly-
    // approved correction in one step — this never throws (the correction
    // is already real and committed by this point; a failure here is only
    // ever a stranded-lock divergence to log and reconcile manually, never
    // a reason to treat the approval itself as failed).
    await releaseCorrectionProcessingLockWithNewVersion(report._id, request._id, result.correction._id);

    await recordAudit({
      req,
      userId: actingUser._id,
      shopId: report.shopId,
      action: AUDIT_ACTIONS.DAILY_REPORT_CORRECTION_APPROVED,
      entityType: 'DailySalesCorrection',
      entityId: result.correction._id,
      previousValue: { totalQuantitySold: previousEffective.quantity },
      newValue: {
        totalQuantitySold,
        expectedClosingStockQuantity,
        stockVarianceQuantity,
        expectedRevenueKobo,
        moneyVarianceKobo,
        quantityChanged,
      },
    });

    await result.correction.populate(CORRECTION_POPULATE);
    return { correction: result.correction, request: result.request };
  } catch (err) {
    // Any failure here means the WHOLE attempt failed — the correction,
    // its ledger effects, and the request's final transition are all
    // created (or cleaned up) together inside runWithOptionalTransaction
    // above (atomically on a replica set; via manual cleanup on our
    // confirmed-standalone MongoDB). So by the time we reach here, the
    // request is guaranteed to still be PROCESSING with nothing else
    // committed — reverting it to PENDING is always safe. A genuine hard
    // process crash between the claim above and this catch running is the
    // one case this can't fix — see the comment on the atomic claim above
    // and README "Correction approval state machine".
    if (lockClaimed) {
      // Release the coordination lock (never changes effectiveCorrectionId
      // here — the correction never became real) so subsequent stock/money
      // resolution attempts against this still-current version aren't
      // blocked forever by a lock nobody would otherwise release.
      await releaseCorrectionProcessingLockOnFailure(request.dailySalesReportId, request._id).catch((lockErr) => {
        // eslint-disable-next-line no-console
        console.error('[DAILY_CORRECTION_REVERT_FAILURE]', { id, lockErr });
      });
    }
    await DailyReportCorrectionRequest.updateOne(
      { _id: id, status: 'PROCESSING' },
      { status: 'PENDING', reviewedBy: null, reviewedAt: null }
    ).catch((revertErr) => {
      // eslint-disable-next-line no-console
      console.error('[DAILY_CORRECTION_REVERT_FAILURE]', { id, revertErr });
    });
    throw err;
  }
}

// Normalizes an effective-version id (ObjectId, string, or null) to
// exactly what an aggregation $match needs: a real ObjectId, or null.
function toVersionMatchValue(effectiveCorrectionId) {
  return effectiveCorrectionId ? new mongoose.Types.ObjectId(effectiveCorrectionId) : null;
}

// BUSINESS TRUTH, not the coordination cache: the sum of quantities from
// StockVarianceResolution documents that are (a) ACTIVE and (b) posted
// against the SPECIFIED effective version — dailySalesCorrectionId must
// match exactly (null means "the original report", not "any version").
// Historical resolutions against an older effective version remain fully
// visible in history but never reduce a newer version's unresolved
// discrepancy. See README "Source-of-truth hierarchy" /
// "Filter resolutions by effective version".
export async function getActiveStockResolutionMagnitude(reportId, effectiveCorrectionId) {
  const [result] = await StockVarianceResolution.aggregate([
    {
      $match: {
        dailySalesReportId: new mongoose.Types.ObjectId(reportId),
        dailySalesCorrectionId: toVersionMatchValue(effectiveCorrectionId),
        status: 'ACTIVE',
      },
    },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  return result?.total ?? 0;
}

// Same as above, for MoneyVarianceResolution.
export async function getActiveMoneyResolutionMagnitude(reportId, effectiveCorrectionId) {
  const [result] = await MoneyVarianceResolution.aggregate([
    {
      $match: {
        dailySalesReportId: new mongoose.Types.ObjectId(reportId),
        dailySalesCorrectionId: toVersionMatchValue(effectiveCorrectionId),
        status: 'ACTIVE',
      },
    },
    { $group: { _id: null, total: { $sum: '$amountKobo' } } },
  ]);
  return result?.total ?? 0;
}

function effectiveSnapshotFrom(report, latestCorrection) {
  if (latestCorrection) {
    return {
      salesLines: latestCorrection.salesLines,
      totalQuantitySold: latestCorrection.totalQuantitySold,
      expectedClosingStockQuantity: latestCorrection.expectedClosingStockQuantity,
      physicalClosingStockQuantity: latestCorrection.physicalClosingStockQuantity,
      stockVarianceQuantity: latestCorrection.stockVarianceQuantity,
      expectedRevenueKobo: latestCorrection.expectedRevenueKobo,
      actualAmountCollectedKobo: latestCorrection.actualAmountCollectedKobo,
      moneyVarianceKobo: latestCorrection.moneyVarianceKobo,
      saleInventoryTransactionId: latestCorrection.effectiveSaleInventoryTransactionId,
      correctionId: latestCorrection._id,
      correctionNumber: latestCorrection.correctionNumber,
    };
  }
  return {
    salesLines: report.salesLines,
    totalQuantitySold: report.totalQuantitySold,
    expectedClosingStockQuantity: report.expectedClosingStockQuantity,
    physicalClosingStockQuantity: report.physicalClosingStockQuantity,
    stockVarianceQuantity: report.stockVarianceQuantity,
    expectedRevenueKobo: report.expectedRevenueKobo,
    actualAmountCollectedKobo: report.actualAmountCollectedKobo,
    moneyVarianceKobo: report.moneyVarianceKobo,
    saleInventoryTransactionId: report.saleInventoryTransactionId,
    correctionId: null,
    correctionNumber: 0,
  };
}

// The single reusable source of "what is the corrected version of this
// historical report, right now" — see README "Effective-report concept".
// Never duplicate this logic in a controller.
export async function getEffectiveDailyReport(reportId) {
  const report = await DailySalesReport.findById(reportId).populate([
    { path: 'shopId', select: 'name code' },
    { path: 'productId', select: 'name sku unit' },
    { path: 'submittedBy', select: 'name role' },
  ]);
  if (!report) throw ApiError.notFound('Daily sales report not found');

  const corrections = await DailySalesCorrection.find({ dailySalesReportId: reportId })
    .sort({ correctionNumber: 1 })
    .populate(CORRECTION_POPULATE);
  const latestCorrection = corrections.length ? corrections[corrections.length - 1] : null;

  const effective = effectiveSnapshotFrom(report, latestCorrection);
  const effectiveCorrectionId = latestCorrection?._id ?? null;

  const [stockResolutions, moneyResolutions, activeStockMagnitude, activeMoneyMagnitude, coordination] =
    await Promise.all([
      StockVarianceResolution.find({ dailySalesReportId: reportId })
        .sort({ createdAt: 1 })
        .populate([
          { path: 'resolvedBy', select: 'name role' },
          { path: 'reversedBy', select: 'name role' },
        ]),
      MoneyVarianceResolution.find({ dailySalesReportId: reportId })
        .sort({ createdAt: 1 })
        .populate([
          { path: 'resolvedBy', select: 'name role' },
          { path: 'reversedBy', select: 'name role' },
        ]),
      // BUSINESS TRUTH — aggregated fresh from ACTIVE resolution documents
      // for the current effective version, never trusted from the
      // coordination-state cache. See README "Source-of-truth hierarchy".
      getActiveStockResolutionMagnitude(reportId, effectiveCorrectionId),
      getActiveMoneyResolutionMagnitude(reportId, effectiveCorrectionId),
      // Coordination cache — used ONLY for the diagnostic "processing"
      // amounts below, and for the divergence check.
      getActiveMagnitudes(reportId),
    ]);

  // Diagnostic-only: if the coordination cache disagrees with the true
  // ACTIVE-document sum FOR THE SAME effective version, that's a real bug
  // to investigate — log it loudly, but never let the cache override the
  // aggregated business truth returned below. A mismatch while the
  // coordination state is tracking a DIFFERENT effective version is not
  // comparable (that's syncResolutionStateToEffectiveVersion's concern,
  // not this one), so only compare when the versions actually match.
  const coordinationTracksCurrentVersion =
    (coordination.effectiveCorrectionId ? coordination.effectiveCorrectionId.toString() : null) ===
    (effectiveCorrectionId ? effectiveCorrectionId.toString() : null);
  if (
    coordinationTracksCurrentVersion &&
    (coordination.activeStockVarianceMagnitude !== activeStockMagnitude ||
      coordination.activeMoneyVarianceMagnitudeKobo !== activeMoneyMagnitude)
  ) {
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
      reportId,
      effectiveCorrectionId,
      cachedActiveStockVarianceMagnitude: coordination.activeStockVarianceMagnitude,
      trueActiveStockResolutionMagnitude: activeStockMagnitude,
      cachedActiveMoneyVarianceMagnitudeKobo: coordination.activeMoneyVarianceMagnitudeKobo,
      trueActiveMoneyResolutionMagnitudeKobo: activeMoneyMagnitude,
    });
  }

  return {
    original: report,
    corrections,
    effectiveCorrection: latestCorrection,
    effective,
    isCorrected: Boolean(latestCorrection),
    // "Remaining" is ABS(effective variance) minus the ACTIVE-resolution
    // sum for the current effective version, sign preserved. A PROCESSING
    // (in-flight, reserved) resolution is never subtracted here.
    unresolvedStockVarianceQuantity: computeRemainingSigned(effective.stockVarianceQuantity, activeStockMagnitude),
    unresolvedMoneyVarianceKobo: computeRemainingSigned(effective.moneyVarianceKobo, activeMoneyMagnitude),
    // User-facing "resolved" — the true ACTIVE-document aggregation for the
    // current effective version, never the coordination cache, never
    // PROCESSING.
    resolvedStockVarianceMagnitude: activeStockMagnitude,
    resolvedMoneyVarianceMagnitudeKobo: activeMoneyMagnitude,
    // Separate, explicit "in flight, not yet resolved" amounts (from the
    // coordination cache — this IS what that cache is for) — a UI can show
    // these as "N bags currently processing" without ever implying they're
    // resolved.
    processingStockResolutionMagnitude: coordination.reservedStockVarianceMagnitude,
    processingMoneyResolutionMagnitudeKobo: coordination.reservedMoneyVarianceMagnitudeKobo,
    stockResolutions,
    moneyResolutions,
  };
}
