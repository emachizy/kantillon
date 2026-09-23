import mongoose from 'mongoose';
import { StockVarianceResolution } from '../models/StockVarianceResolution.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { DailyReportResolutionState } from '../models/DailyReportResolutionState.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { getEffectiveDailyReport } from './dailyReportCorrectionService.js';
import { resolvePostingBusinessDate } from './dailySalesReportService.js';
import { syncResolutionStateToEffectiveVersion } from './dailyReportResolutionStateService.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';

const RESOLUTION_POPULATE = [
  { path: 'resolvedBy', select: 'name role' },
  { path: 'reversedBy', select: 'name role' },
];

// "The original report was accurate, but a real shortage/surplus/damage
// occurred." This never touches the DailySalesReport or DailySalesCorrection
// snapshot — it posts an additional, independently-visible ledger
// transaction that brings official stock in line with reality, and a
// StockVarianceResolution record explaining why. See README "Stock variance
// resolution" for the full worked example.
//
// State transition sequence (see README "Reserved vs active" and
// "Resolution reservation crash safety"):
//   1. Pre-generate a deterministic resolution _id.
//   2. Create the StockVarianceResolution record, status PROCESSING — a
//      reservation is never a completed resolution, and this record makes
//      the attempt visible/auditable even if a later step fails.
//   3. Atomically reserve: reservedStockVarianceMagnitude += quantity,
//      bounded by reserved+active+quantity <= |effective variance|. Two
//      concurrent requests can never together over-resolve, with no
//      read-then-write window.
//   4. Create the InventoryTransaction ledger effect (deterministic
//      effectKey) — never created before step 3 succeeds.
//   5. Atomically finalize: reserved -= quantity, active += quantity.
//   6. Mark the resolution ACTIVE.
// All of steps 2-6 run inside runWithOptionalTransaction: on a replica set
// this is genuinely atomic (all-or-nothing). On our confirmed-standalone
// MongoDB it is not — each step commits individually, and a normal
// (catchable) failure is compensated manually below, unwinding whichever
// of reserved/active/ledger/record state was actually reached. A genuine
// hard process crash between these sequential writes is a residual gap
// this cannot close: it would leave the resolution record stranded in
// PROCESSING, with its quantity still counted in "reserved" (blocking
// conflicting over-resolution) but never in "active" (never shown to a
// user as resolved), and reversible only through manual review (querying
// status: 'PROCESSING'), not through the normal /reverse endpoint. That is
// a deliberate, visible, queryable failure mode — never a silently-wrong
// balance — and is preferable to pretending a guarantee standalone
// MongoDB cannot give. No background recovery daemon is implemented.
export async function createStockVarianceResolution({
  reportId,
  resolutionType,
  quantity,
  reason,
  notes,
  actingUser,
  req,
}) {
  const effective = await getEffectiveDailyReport(reportId);
  const report = effective.original;
  const effectiveVariance = effective.effective.stockVarianceQuantity;
  const effectiveCorrectionId = effective.effectiveCorrection?._id ?? null;

  if (effectiveVariance === 0) {
    throw ApiError.conflict('This report has no stock variance; there is nothing to resolve');
  }

  const isShortage = effectiveVariance < 0;
  if (isShortage && resolutionType === 'SURPLUS') {
    throw ApiError.badRequest('SURPLUS cannot be used against a negative (shortage) variance');
  }
  if (!isShortage && resolutionType !== 'SURPLUS') {
    throw ApiError.badRequest(
      `${resolutionType} cannot be used against a positive (surplus) variance — use SURPLUS`
    );
  }

  const direction = resolutionType === 'SURPLUS' ? 'IN' : 'OUT';
  const magnitude = Math.abs(effectiveVariance);

  const postingBusinessDate = await resolvePostingBusinessDate(
    report.shopId,
    report.productId,
    report.businessDate
  );

  // Defensive backstop — see dailyReportResolutionStateService.js. Also
  // guarantees the coordination doc exists before the reservation below.
  await syncResolutionStateToEffectiveVersion(report._id, effectiveCorrectionId);

  const resolutionId = new mongoose.Types.ObjectId();
  const effectKey = `stock-resolution:${resolutionId}:adjustment`;
  const now = new Date();

  let resolution;
  let transaction;
  try {
    const result = await runWithOptionalTransaction(async (session) => {
      let createdResolution;
      let reserved = false;
      let finalized = false;
      let createdTransaction;
      try {
        // Step 2: PROCESSING record first — never a completed resolution.
        [createdResolution] = await StockVarianceResolution.create(
          [
            {
              _id: resolutionId,
              dailySalesReportId: report._id,
              dailySalesCorrectionId: effectiveCorrectionId,
              shopId: report.shopId,
              productId: report.productId,
              sourceBusinessDate: report.businessDate,
              resolutionType,
              quantity,
              direction,
              reason,
              notes,
              status: 'PROCESSING',
              resolvedBy: actingUser._id,
              resolvedAt: now,
              postingBusinessDate,
            },
          ],
          { session }
        );

        // Step 3: atomic reservation. reserved+active+requested must never
        // exceed the absolute effective variance — never trusts a
        // client-supplied "remaining" number.
        const reservedDoc = await DailyReportResolutionState.findOneAndUpdate(
          {
            dailySalesReportId: report._id,
            effectiveCorrectionId,
            $expr: {
              $lte: [
                {
                  $add: [
                    '$reservedStockVarianceMagnitude',
                    '$activeStockVarianceMagnitude',
                    quantity,
                  ],
                },
                magnitude,
              ],
            },
          },
          { $inc: { reservedStockVarianceMagnitude: quantity, version: 1 } },
          { new: true, session }
        );

        if (!reservedDoc) {
          const current = await DailyReportResolutionState.findOne(
            { dailySalesReportId: report._id },
            null,
            { session }
          );
          const claimed =
            (current?.reservedStockVarianceMagnitude ?? 0) + (current?.activeStockVarianceMagnitude ?? 0);
          const remaining = Math.max(magnitude - claimed, 0);
          throw ApiError.conflict(
            `Resolution quantity (${quantity}) exceeds the remaining unresolved stock variance (${remaining})`
          );
        }
        reserved = true;

        // Step 4: the ledger effect — never created before the reservation
        // above has succeeded.
        [createdTransaction] = await InventoryTransaction.create(
          [
            {
              shopId: report.shopId,
              productId: report.productId,
              type: resolutionType,
              direction,
              quantity,
              referenceType: 'STOCK_VARIANCE_RESOLUTION',
              referenceId: resolutionId,
              status: 'APPROVED',
              createdBy: actingUser._id,
              approvedBy: actingUser._id,
              approvedAt: now,
              businessDate: postingBusinessDate,
              effectKey,
            },
          ],
          { session }
        );

        // Step 5: move the claim from reserved to active.
        await DailyReportResolutionState.updateOne(
          { dailySalesReportId: report._id },
          {
            $inc: {
              reservedStockVarianceMagnitude: -quantity,
              activeStockVarianceMagnitude: quantity,
              version: 1,
            },
          },
          { session }
        );
        finalized = true;

        // Step 6: only now is this resolution ACTUALLY resolved.
        await StockVarianceResolution.updateOne(
          { _id: resolutionId },
          { status: 'ACTIVE', inventoryTransactionId: createdTransaction._id },
          { session }
        );
        createdResolution.status = 'ACTIVE';
        createdResolution.inventoryTransactionId = createdTransaction._id;

        return { resolution: createdResolution, transaction: createdTransaction };
      } catch (err) {
        if (session) {
          // A real transaction rolls everything above back atomically —
          // nothing to manually compensate.
          throw err;
        }

        if (finalized) {
          // The claim already moved to active — undo that move, not the
          // (already-cleared) reservation.
          await DailyReportResolutionState.updateOne(
            { dailySalesReportId: report._id },
            { $inc: { activeStockVarianceMagnitude: -quantity } }
          ).catch((revertErr) => {
            // eslint-disable-next-line no-console
            console.error('[STOCK_VARIANCE_RESOLUTION_REVERT_FAILURE]', { reportId: report._id, revertErr });
          });
        } else if (reserved) {
          await DailyReportResolutionState.updateOne(
            { dailySalesReportId: report._id },
            { $inc: { reservedStockVarianceMagnitude: -quantity } }
          ).catch((revertErr) => {
            // eslint-disable-next-line no-console
            console.error('[STOCK_VARIANCE_RESOLUTION_REVERT_FAILURE]', { reportId: report._id, revertErr });
          });
        }
        if (createdTransaction) {
          await InventoryTransaction.deleteOne({ _id: createdTransaction._id }).catch((cleanupErr) => {
            // eslint-disable-next-line no-console
            console.error('[STOCK_VARIANCE_RESOLUTION_CLEANUP_FAILURE]', {
              reportId: report._id,
              transactionId: createdTransaction._id,
              cleanupErr,
            });
          });
        }
        if (createdResolution) {
          await StockVarianceResolution.deleteOne({ _id: createdResolution._id }).catch((cleanupErr) => {
            // eslint-disable-next-line no-console
            console.error('[STOCK_VARIANCE_RESOLUTION_CLEANUP_FAILURE]', {
              reportId: report._id,
              resolutionId,
              cleanupErr,
            });
          });
        }
        throw err;
      }
    });
    ({ resolution, transaction } = result);
  } catch (err) {
    if (err instanceof ApiError) {
      // An expected business conflict (over-resolution) — already cleanly
      // compensated (or rolled back) above; nothing left half-applied.
      throw err;
    }
    // eslint-disable-next-line no-console
    console.error('[STOCK_VARIANCE_RESOLUTION_PARTIAL_FAILURE]', {
      reportId: report._id,
      resolutionId,
      originalError: err,
    });
    throw ApiError.internal('Failed to post stock variance resolution consistently. Please try again.');
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: report.shopId,
    action: AUDIT_ACTIONS.STOCK_VARIANCE_RESOLVED,
    entityType: 'StockVarianceResolution',
    entityId: resolution._id,
    newValue: { resolutionType, quantity, direction, postingBusinessDate, reason },
  });

  await resolution.populate(RESOLUTION_POPULATE);
  const updatedState = await DailyReportResolutionState.findOne({ dailySalesReportId: report._id }).select(
    'activeStockVarianceMagnitude'
  );
  return {
    resolution,
    transaction,
    remainingStockVarianceQuantity:
      effectiveVariance < 0
        ? -(magnitude - updatedState.activeStockVarianceMagnitude)
        : magnitude - updatedState.activeStockVarianceMagnitude,
  };
}

export async function reverseStockVarianceResolution({ id, reason, actingUser, req }) {
  const now = new Date();

  // Only a completed (ACTIVE) resolution may be reversed through this
  // endpoint — PROCESSING (409, still in flight / possibly crash-stranded)
  // and REVERSED (409, already undone) are both rejected. Atomic
  // conditional status gate: two simultaneous reversals yield one success
  // and one 409.
  const resolution = await StockVarianceResolution.findOneAndUpdate(
    { _id: id, status: 'ACTIVE' },
    { status: 'REVERSED', reversedBy: actingUser._id, reversedAt: now, reversalReason: reason },
    { new: true }
  );

  if (!resolution) {
    const current = await StockVarianceResolution.findById(id);
    if (!current) throw ApiError.notFound('Stock variance resolution not found');
    throw ApiError.conflict(`Resolution is already ${current.status} and cannot be reversed`);
  }

  const reversalDirection = resolution.direction === 'IN' ? 'OUT' : 'IN';

  let reversalTxn;
  try {
    reversalTxn = await InventoryTransaction.create({
      shopId: resolution.shopId,
      productId: resolution.productId,
      type: 'REVERSAL',
      direction: reversalDirection,
      quantity: resolution.quantity,
      referenceType: 'STOCK_VARIANCE_RESOLUTION',
      referenceId: resolution._id,
      status: 'APPROVED',
      createdBy: actingUser._id,
      approvedBy: actingUser._id,
      approvedAt: now,
      // Reuse the original posting date — it was already validated as safe
      // to post on, and keeping the pair on the same date makes their net
      // zero effect land on one day rather than splitting across two.
      businessDate: resolution.postingBusinessDate,
      effectKey: `stock-resolution:${resolution._id}:reversal`,
    });
  } catch (err) {
    await StockVarianceResolution.updateOne(
      { _id: id },
      { status: 'ACTIVE', reversedBy: null, reversedAt: null, reversalReason: null }
    ).catch((revertErr) => {
      // eslint-disable-next-line no-console
      console.error('[STOCK_VARIANCE_REVERSAL_REVERT_FAILURE]', { id, revertErr });
    });
    // eslint-disable-next-line no-console
    console.error('[STOCK_VARIANCE_RESOLUTION_PARTIAL_FAILURE]', { id, originalError: err });
    throw ApiError.internal('Failed to reverse stock variance resolution consistently. Please try again.');
  }

  await StockVarianceResolution.updateOne(
    { _id: id },
    { reversalInventoryTransactionId: reversalTxn._id }
  );

  // A reversed resolution no longer counts as resolved — decrement ACTIVE
  // (never reserved; reservations are unrelated to a completed resolution
  // being undone). There is exactly one coordination doc per report (never
  // per version — see model comment), so a plain dailySalesReportId match
  // is sufficient here.
  await DailyReportResolutionState.updateOne(
    { dailySalesReportId: resolution.dailySalesReportId },
    { $inc: { activeStockVarianceMagnitude: -resolution.quantity, version: 1 } }
  );

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: resolution.shopId,
    action: AUDIT_ACTIONS.STOCK_VARIANCE_RESOLUTION_REVERSED,
    entityType: 'StockVarianceResolution',
    entityId: resolution._id,
    reason,
  });

  const populated = await StockVarianceResolution.findById(id).populate(RESOLUTION_POPULATE);
  return { resolution: populated, reversalTransaction: reversalTxn };
}

export async function listStockVarianceResolutionsForReport(reportId) {
  return StockVarianceResolution.find({ dailySalesReportId: reportId })
    .sort({ createdAt: 1 })
    .populate(RESOLUTION_POPULATE);
}
