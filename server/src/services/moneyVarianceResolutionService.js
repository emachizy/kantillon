import mongoose from 'mongoose';
import { MoneyVarianceResolution } from '../models/MoneyVarianceResolution.js';
import { DailyReportResolutionState } from '../models/DailyReportResolutionState.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { getEffectiveDailyReport, getActiveMoneyResolutionMagnitude } from './dailyReportCorrectionService.js';
import { syncResolutionStateToEffectiveVersion } from './dailyReportResolutionStateService.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';

const RESOLUTION_POPULATE = [
  { path: 'resolvedBy', select: 'name role' },
  { path: 'reversedBy', select: 'name role' },
];

// Money discrepancies are an accountability record only — this NEVER
// creates an InventoryTransaction. See README "Source-of-truth hierarchy"
// and stockVarianceResolutionService.js for the shared reserved/active
// state-transition and crash-safety reasoning (identical here, minus the
// ledger-transaction step):
//   1. Pre-generate a deterministic resolution _id.
//   2. Create the MoneyVarianceResolution record, status PROCESSING.
//   3. Atomically reserve: reservedMoneyVarianceMagnitudeKobo += amount,
//      bounded by reserved+active+amount <= |effective variance|.
//   4. Mark the resolution ACTIVE — this write is what makes it
//      business-truth resolved, not the coordination-state move below.
//   5. Best-effort bookkeeping: move the coordination cache's claim from
//      reserved to active. A failure here is logged as a cache divergence
//      and never undoes the already-real ACTIVE resolution from step 4.
// Marking ACTIVE before the coordination-cache move (not after) means a
// hard crash between them leaves the resolution truthfully ACTIVE, with
// only the internal cache stale — see stockVarianceResolutionService.js
// for the full reasoning (identical here).
export async function createMoneyVarianceResolution({
  reportId,
  resolutionType,
  amountKobo,
  reason,
  notes,
  actingUser,
  req,
}) {
  const effective = await getEffectiveDailyReport(reportId);
  const report = effective.original;
  const effectiveVariance = effective.effective.moneyVarianceKobo;
  const effectiveCorrectionId = effective.effectiveCorrection?._id ?? null;

  if (effectiveVariance === 0) {
    throw ApiError.conflict('This report has no money variance; there is nothing to resolve');
  }

  const magnitude = Math.abs(effectiveVariance);

  await syncResolutionStateToEffectiveVersion(report._id, effectiveCorrectionId);

  const resolutionId = new mongoose.Types.ObjectId();
  const now = new Date();

  let resolution;
  try {
    const result = await runWithOptionalTransaction(async (session) => {
      let createdResolution;
      let reserved = false;
      let activated = false;
      try {
        // Step 2: PROCESSING record first — never a completed resolution.
        [createdResolution] = await MoneyVarianceResolution.create(
          [
            {
              _id: resolutionId,
              dailySalesReportId: report._id,
              dailySalesCorrectionId: effectiveCorrectionId,
              shopId: report.shopId,
              sourceBusinessDate: report.businessDate,
              resolutionType,
              amountKobo,
              reason,
              notes,
              status: 'PROCESSING',
              resolvedBy: actingUser._id,
              resolvedAt: now,
            },
          ],
          { session }
        );

        // Step 3: atomic reservation, same strategy as stock variance
        // resolution — reserved+active+requested must never exceed the
        // absolute effective variance. correctionProcessing must be false
        // in this SAME filter — see stockVarianceResolutionService.js /
        // README "Correction/resolution shared lock".
        const reservedDoc = await DailyReportResolutionState.findOneAndUpdate(
          {
            dailySalesReportId: report._id,
            effectiveCorrectionId,
            correctionProcessing: false,
            $expr: {
              $lte: [
                {
                  $add: [
                    '$reservedMoneyVarianceMagnitudeKobo',
                    '$activeMoneyVarianceMagnitudeKobo',
                    amountKobo,
                  ],
                },
                magnitude,
              ],
            },
          },
          { $inc: { reservedMoneyVarianceMagnitudeKobo: amountKobo, version: 1 } },
          { new: true, session }
        );

        if (!reservedDoc) {
          const current = await DailyReportResolutionState.findOne(
            { dailySalesReportId: report._id },
            null,
            { session }
          );
          if (current?.correctionProcessing) {
            throw ApiError.conflict(
              'A correction is currently being approved for this report; try again once it completes.'
            );
          }
          const claimed =
            (current?.reservedMoneyVarianceMagnitudeKobo ?? 0) +
            (current?.activeMoneyVarianceMagnitudeKobo ?? 0);
          const remaining = Math.max(magnitude - claimed, 0);
          throw ApiError.conflict(
            `Resolution amount (${amountKobo} kobo) exceeds the remaining unresolved money variance ` +
              `(${remaining} kobo)`
          );
        }
        reserved = true;

        // Step 4: mark ACTIVE — the business-truth-making write. See the
        // comment above this function.
        await MoneyVarianceResolution.updateOne(
          { _id: resolutionId },
          { status: 'ACTIVE' },
          { session }
        );
        createdResolution.status = 'ACTIVE';
        activated = true;

        // Step 5: best-effort coordination-cache bookkeeping. A failure
        // here must NEVER undo the already-real ACTIVE resolution above.
        try {
          await DailyReportResolutionState.updateOne(
            { dailySalesReportId: report._id },
            {
              $inc: {
                reservedMoneyVarianceMagnitudeKobo: -amountKobo,
                activeMoneyVarianceMagnitudeKobo: amountKobo,
                version: 1,
              },
            },
            { session }
          );
        } catch (coordErr) {
          // eslint-disable-next-line no-console
          console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
            reportId: report._id,
            resolutionId,
            amountKobo,
            reason: 'coordination-state reserved->active move failed after resolution was marked ACTIVE',
            coordErr,
          });
        }

        return createdResolution;
      } catch (err) {
        if (session) {
          throw err;
        }

        if (activated) {
          // The resolution is genuinely ACTIVE — never unwind real business
          // truth over a failure at this point. (Unreachable in the
          // current code since step 5 catches its own errors — kept as a
          // guard against future reordering.)
          throw err;
        }

        if (reserved) {
          await DailyReportResolutionState.updateOne(
            { dailySalesReportId: report._id },
            { $inc: { reservedMoneyVarianceMagnitudeKobo: -amountKobo } }
          ).catch((revertErr) => {
            // eslint-disable-next-line no-console
            console.error('[MONEY_VARIANCE_RESOLUTION_REVERT_FAILURE]', { reportId: report._id, revertErr });
          });
        }
        if (createdResolution) {
          await MoneyVarianceResolution.deleteOne({ _id: createdResolution._id }).catch((cleanupErr) => {
            // eslint-disable-next-line no-console
            console.error('[MONEY_VARIANCE_RESOLUTION_CLEANUP_FAILURE]', {
              reportId: report._id,
              resolutionId,
              cleanupErr,
            });
          });
        }
        throw err;
      }
    });
    resolution = result;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    // eslint-disable-next-line no-console
    console.error('[MONEY_VARIANCE_RESOLUTION_PARTIAL_FAILURE]', {
      reportId: report._id,
      resolutionId,
      originalError: err,
    });
    throw ApiError.internal('Failed to post money variance resolution consistently. Please try again.');
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: report.shopId,
    action: AUDIT_ACTIONS.MONEY_VARIANCE_RESOLVED,
    entityType: 'MoneyVarianceResolution',
    entityId: resolution._id,
    newValue: { resolutionType, amountKobo, reason },
  });

  await resolution.populate(RESOLUTION_POPULATE);
  // BUSINESS TRUTH — aggregated fresh from ACTIVE resolution documents,
  // never the coordination cache. See README "Source-of-truth hierarchy".
  const updatedActiveMagnitude = await getActiveMoneyResolutionMagnitude(report._id, effectiveCorrectionId);
  return {
    resolution,
    remainingMoneyVarianceKobo:
      effectiveVariance < 0
        ? -(magnitude - updatedActiveMagnitude)
        : magnitude - updatedActiveMagnitude,
  };
}

export async function reverseMoneyVarianceResolution({ id, reason, actingUser, req }) {
  const now = new Date();

  // Only ACTIVE may be reversed — PROCESSING (409) and REVERSED (409) are
  // both rejected. Atomic conditional status gate: two simultaneous
  // reversals yield one success and one 409.
  const resolution = await MoneyVarianceResolution.findOneAndUpdate(
    { _id: id, status: 'ACTIVE' },
    { status: 'REVERSED', reversedBy: actingUser._id, reversedAt: now, reversalReason: reason },
    { new: true }
  ).populate(RESOLUTION_POPULATE);

  if (!resolution) {
    const current = await MoneyVarianceResolution.findById(id);
    if (!current) throw ApiError.notFound('Money variance resolution not found');
    throw ApiError.conflict(`Resolution is already ${current.status} and cannot be reversed`);
  }

  // The resolution is now REVERSED — already excluded from the
  // ACTIVE-document aggregation regardless of what happens next. The
  // coordination-cache decrement below is best-effort only and must never
  // fail the reversal itself — see stockVarianceResolutionService.js.
  try {
    await DailyReportResolutionState.updateOne(
      { dailySalesReportId: resolution.dailySalesReportId },
      { $inc: { activeMoneyVarianceMagnitudeKobo: -resolution.amountKobo, version: 1 } }
    );
  } catch (coordErr) {
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
      reportId: resolution.dailySalesReportId,
      resolutionId: id,
      amountKobo: resolution.amountKobo,
      reason: 'coordination-state active decrement failed after resolution was marked REVERSED',
      coordErr,
    });
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: resolution.shopId,
    action: AUDIT_ACTIONS.MONEY_VARIANCE_RESOLUTION_REVERSED,
    entityType: 'MoneyVarianceResolution',
    entityId: resolution._id,
    reason,
  });

  return resolution;
}

export async function listMoneyVarianceResolutionsForReport(reportId) {
  return MoneyVarianceResolution.find({ dailySalesReportId: reportId })
    .sort({ createdAt: 1 })
    .populate(RESOLUTION_POPULATE);
}
