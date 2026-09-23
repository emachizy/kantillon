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
  syncResolutionStateToEffectiveVersion,
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

  // Once this is true, the DailySalesCorrection (and any ledger effects)
  // are real and committed — the catch block below must never revert the
  // request back to PENDING past this point, since that would let it be
  // re-approved into a SECOND correction on top of one that already
  // exists. Anything that fails after this is a workflow-state divergence
  // to surface loudly, not something to paper over. Declared here (outside
  // the try) so the catch block below can read it.
  let correctionEffectsCompleted = false;

  try {
    const report = await DailySalesReport.findById(request.dailySalesReportId);
    if (!report) throw ApiError.internal('The daily sales report linked to this correction no longer exists');

    // Re-check: a resolution could theoretically have been posted while
    // this request sat PENDING. Never silently approve into that state.
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

    const result = await runWithOptionalTransaction(async (session) => {
      let createdCorrection;
      let reversalTxn;
      let replacementTxn;
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

        return { correction: createdCorrection, reversalTxn, replacementTxn };
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

    correctionEffectsCompleted = true;

    // Only now — after the correction and its ledger effects fully exist —
    // does the request become visibly APPROVED. This is itself an atomic
    // conditional transition (still PROCESSING), and we return THIS
    // document, never the stale PROCESSING one captured at claim time —
    // the API must never report PROCESSING as the outcome of a successful
    // approval.
    const finalRequest = await DailyReportCorrectionRequest.findOneAndUpdate(
      { _id: request._id, status: 'PROCESSING' },
      { status: 'APPROVED', approvedCorrectionId: result.correction._id },
      { new: true }
    ).populate(REQUEST_POPULATE);

    if (!finalRequest) {
      // The correction was built successfully and already committed, but
      // the request unexpectedly wasn't PROCESSING anymore (something else
      // must have mutated it — this should be unreachable in normal
      // operation, since we hold the only valid PROCESSING claim). Do NOT
      // silently treat this as success, and do NOT let the catch below
      // revert it to PENDING (the correction is real; reverting would let
      // it be approved a second time). Surface it loudly for manual review.
      const current = await DailyReportCorrectionRequest.findById(request._id);
      // eslint-disable-next-line no-console
      console.error('[DAILY_CORRECTION_WORKFLOW_DIVERGENCE]', {
        requestId: request._id,
        correctionId: result.correction._id,
        expectedStatus: 'PROCESSING',
        actualStatus: current?.status ?? '(request no longer exists)',
      });
      throw ApiError.internal(
        'The correction was built successfully, but the request could not be finalized as ' +
          'APPROVED due to an unexpected workflow-state divergence. The correction record exists ' +
          'and must be reconciled manually — see server logs for DAILY_CORRECTION_WORKFLOW_DIVERGENCE.'
      );
    }

    // The newly-approved correction is now the effective version; make sure
    // the resolution-state coordination doc (if one exists yet) reflects
    // that. All four counters are guaranteed zero at this point (the
    // hasAnyResolutionActivity check above), so this is bookkeeping, not a
    // reset of anything live.
    await syncResolutionStateToEffectiveVersion(report._id, result.correction._id);

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
    return { correction: result.correction, request: finalRequest };
  } catch (err) {
    if (correctionEffectsCompleted) {
      // The correction already exists — never revert to PENDING past this
      // point (see the comment where the flag is set above). Just surface
      // the error; DAILY_CORRECTION_WORKFLOW_DIVERGENCE (if that's what
      // this is) was already logged above.
      throw err;
    }

    // The approval's actual effect never completed — revert the request
    // from PROCESSING back to PENDING so it doesn't sit forever in a state
    // that looks like "someone is handling this" with nothing behind it.
    // A genuine hard process crash between the claim above and this catch
    // running is the one case this can't fix — see the comment on the
    // atomic claim above and README "Correction approval state machine".
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

  const [stockResolutions, moneyResolutions, magnitudes] = await Promise.all([
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
    getActiveMagnitudes(reportId),
  ]);

  return {
    original: report,
    corrections,
    effectiveCorrection: latestCorrection,
    effective,
    isCorrected: Boolean(latestCorrection),
    // "Remaining" is computed from ACTIVE resolutions only — a PROCESSING
    // (in-flight, reserved) resolution is never subtracted from the
    // business-facing remaining variance. See README "Reserved vs active".
    unresolvedStockVarianceQuantity: computeRemainingSigned(
      effective.stockVarianceQuantity,
      magnitudes.activeStockVarianceMagnitude
    ),
    unresolvedMoneyVarianceKobo: computeRemainingSigned(
      effective.moneyVarianceKobo,
      magnitudes.activeMoneyVarianceMagnitudeKobo
    ),
    // User-facing "resolved" — ACTIVE only, never includes PROCESSING.
    resolvedStockVarianceMagnitude: magnitudes.activeStockVarianceMagnitude,
    resolvedMoneyVarianceMagnitudeKobo: magnitudes.activeMoneyVarianceMagnitudeKobo,
    // Separate, explicit "in flight, not yet resolved" amounts — a UI can
    // show these as "N bags currently processing" without ever implying
    // they're resolved.
    processingStockResolutionMagnitude: magnitudes.reservedStockVarianceMagnitude,
    processingMoneyResolutionMagnitudeKobo: magnitudes.reservedMoneyVarianceMagnitudeKobo,
    stockResolutions,
    moneyResolutions,
  };
}
