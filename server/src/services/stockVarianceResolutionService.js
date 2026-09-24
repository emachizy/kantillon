import mongoose from 'mongoose';
import { StockVarianceResolution } from '../models/StockVarianceResolution.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { DailyReportResolutionState } from '../models/DailyReportResolutionState.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { getEffectiveDailyReport, getActiveStockResolutionMagnitude } from './dailyReportCorrectionService.js';
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
// State transition sequence (see README "Source-of-truth hierarchy" and
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
//   5. Mark the resolution ACTIVE. This write — not the coordination-state
//      move below — is what makes the resolution real, business-truth
//      resolved: StockVarianceResolution documents with status ACTIVE ARE
//      the completed-resolution record (see README "Source-of-truth
//      hierarchy"), and the aggregation that computes user-facing
//      "resolved"/"remaining" reads exactly those documents, never the
//      coordination cache.
//   6. Best-effort bookkeeping: move the coordination cache's claim from
//      reserved to active (reserved -= quantity, active += quantity). If
//      this specific step fails, it is logged as a cache/business-truth
//      divergence and NOT allowed to undo the already-real ACTIVE
//      resolution and ledger effect from steps 4-5 — see the inner
//      try/catch below.
// Marking ACTIVE happens BEFORE the coordination-cache move (not after, as
// an earlier draft of this service did) specifically so a hard crash
// between them leaves the resolution truthfully ACTIVE with its ledger
// effect intact, and only the internal cache stale (conservatively
// over-counting "reserved", which never causes an over-resolution) —
// rather than a resolution that says PROCESSING while an internal counter
// already claims it's active.
// Steps 2-5 run inside runWithOptionalTransaction: on a replica set this is
// genuinely atomic (all-or-nothing). On our confirmed-standalone MongoDB it
// is not — each step commits individually, and a normal (catchable)
// failure BEFORE step 5 succeeds is compensated manually below, unwinding
// whichever of reserved/ledger/record state was actually reached. A
// genuine hard process crash between these sequential writes (before step
// 5) is a residual gap this cannot close: it would leave the resolution
// record stranded in PROCESSING, with its quantity still counted in
// "reserved" (blocking conflicting over-resolution) but never "active"
// (never shown to a user as resolved), reversible only through manual
// review (querying status: 'PROCESSING'), not through the normal /reverse
// endpoint. That is a deliberate, visible, queryable failure mode — never
// a silently-wrong balance — and is preferable to pretending a guarantee
// standalone MongoDB cannot give. No background recovery daemon is
// implemented.
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
      let activated = false;
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
        // client-supplied "remaining" number. correctionProcessing must be
        // false in this SAME filter (not a preceding read) — otherwise a
        // resolution could reserve against a version a correction is about
        // to replace out from under it. See README "Correction/resolution
        // shared lock".
        const reservedDoc = await DailyReportResolutionState.findOneAndUpdate(
          {
            dailySalesReportId: report._id,
            effectiveCorrectionId,
            correctionProcessing: false,
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
          if (current?.correctionProcessing) {
            throw ApiError.conflict(
              'A correction is currently being approved for this report; try again once it completes.'
            );
          }
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

        // Step 5: mark ACTIVE — this write, not the cache move below, is
        // what makes the resolution business-truth real (see README
        // "Source-of-truth hierarchy" and the comment above this function).
        await StockVarianceResolution.updateOne(
          { _id: resolutionId },
          { status: 'ACTIVE', inventoryTransactionId: createdTransaction._id },
          { session }
        );
        createdResolution.status = 'ACTIVE';
        createdResolution.inventoryTransactionId = createdTransaction._id;
        activated = true;

        // Step 6: best-effort coordination-cache bookkeeping. A failure
        // here must NEVER undo the already-real ACTIVE resolution/ledger
        // effect above — it only means the internal cache is stale until
        // reconciled, which is why this is caught and logged locally
        // rather than allowed to propagate into the outer catch below.
        try {
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
        } catch (coordErr) {
          // eslint-disable-next-line no-console
          console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
            reportId: report._id,
            resolutionId,
            quantity,
            reason: 'coordination-state reserved->active move failed after resolution was marked ACTIVE',
            coordErr,
          });
        }

        return { resolution: createdResolution, transaction: createdTransaction };
      } catch (err) {
        if (session) {
          // A real transaction rolls everything above back atomically —
          // nothing to manually compensate. (The coordination-cache step is
          // caught internally above regardless of session, since a cache
          // hiccup should never roll back a real transaction either.)
          throw err;
        }

        if (activated) {
          // The resolution is genuinely ACTIVE with a real ledger effect —
          // never unwind real business truth over a failure at this point.
          // (In the current code this branch is unreachable, since step 6
          // catches its own errors — kept as a guard against future
          // changes reordering steps 5/6.)
          throw err;
        }

        if (reserved) {
          await DailyReportResolutionState.updateOne(
            { dailySalesReportId: report._id },
            { $inc: { reservedStockVarianceMagnitude: -quantity } }
          ).catch((revertErr) => {
            // eslint-disable-next-line no-console
            console.error('[STOCK_VARIANCE_RESOLUTION_REVERT_FAILURE]', { reportId: report._id, revertErr });
          });
        }
        if (createdTransaction) {
          // A ledger effect must never be left behind for a resolution
          // that never became ACTIVE.
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
  // BUSINESS TRUTH — aggregated fresh from ACTIVE resolution documents,
  // never the coordination cache. See README "Source-of-truth hierarchy".
  const updatedActiveMagnitude = await getActiveStockResolutionMagnitude(report._id, effectiveCorrectionId);
  return {
    resolution,
    transaction,
    remainingStockVarianceQuantity:
      effectiveVariance < 0
        ? -(magnitude - updatedActiveMagnitude)
        : magnitude - updatedActiveMagnitude,
  };
}

// Reversal sequence (see README "Stock resolution reversal"):
//   1. Atomic claim: status ACTIVE, reversalProcessing false -> true. Status
//      itself stays ACTIVE — business truth (resolution.status) must never
//      claim REVERSED before the opposing ledger effect safely exists.
//   2. Create the deterministic opposite REVERSAL InventoryTransaction.
//   3. Finalize: status -> REVERSED, reversalProcessing -> false, reversal
//      metadata + reversalInventoryTransactionId set — all in one document.
//   4. Best-effort: decrement the activeStock coordination cache. A
//      failure here is logged as a cache divergence and never undoes the
//      real REVERSED status or ledger effect from steps 2-3.
// Only ACTIVE (with reversalProcessing false) may enter this flow —
// PROCESSING, REVERSED, and "ACTIVE but reversalProcessing already true"
// (someone else's reversal in flight) all get 409. A hard crash between
// steps 1 and 3 leaves reversalProcessing stranded true with status still
// ACTIVE — a visible, queryable manual-review state, never silently
// cleared.
export async function reverseStockVarianceResolution({ id, reason, actingUser, req }) {
  const now = new Date();

  const claimed = await StockVarianceResolution.findOneAndUpdate(
    { _id: id, status: 'ACTIVE', reversalProcessing: false },
    { reversalProcessing: true },
    { new: true }
  );

  if (!claimed) {
    const current = await StockVarianceResolution.findById(id);
    if (!current) throw ApiError.notFound('Stock variance resolution not found');
    if (current.status === 'ACTIVE' && current.reversalProcessing) {
      throw ApiError.conflict('This resolution is currently being reversed by another request; try again shortly');
    }
    throw ApiError.conflict(`Resolution is already ${current.status} and cannot be reversed`);
  }

  const reversalDirection = claimed.direction === 'IN' ? 'OUT' : 'IN';

  let reversalTxn;
  try {
    reversalTxn = await InventoryTransaction.create({
      shopId: claimed.shopId,
      productId: claimed.productId,
      type: 'REVERSAL',
      direction: reversalDirection,
      quantity: claimed.quantity,
      referenceType: 'STOCK_VARIANCE_RESOLUTION',
      referenceId: claimed._id,
      status: 'APPROVED',
      createdBy: actingUser._id,
      approvedBy: actingUser._id,
      approvedAt: now,
      // Reuse the original posting date — it was already validated as safe
      // to post on, and keeping the pair on the same date makes their net
      // zero effect land on one day rather than splitting across two.
      businessDate: claimed.postingBusinessDate,
      effectKey: `stock-resolution:${claimed._id}:reversal`,
    });
  } catch (err) {
    // The ledger effect never came to exist — release the claim, leaving
    // the resolution exactly as it was (still ACTIVE, reversible again).
    await StockVarianceResolution.updateOne(
      { _id: id },
      { reversalProcessing: false }
    ).catch((revertErr) => {
      // eslint-disable-next-line no-console
      console.error('[STOCK_VARIANCE_REVERSAL_REVERT_FAILURE]', { id, revertErr });
    });
    // eslint-disable-next-line no-console
    console.error('[STOCK_VARIANCE_RESOLUTION_PARTIAL_FAILURE]', { id, originalError: err });
    throw ApiError.internal('Failed to reverse stock variance resolution consistently. Please try again.');
  }

  // The ledger effect exists — finalize. If THIS write fails, the ledger
  // effect is real and must not be deleted (undoing it would leave the
  // original adjustment uncountered); the resolution is left stranded
  // ACTIVE + reversalProcessing=true — a visible manual-review state, not
  // silently cleared.
  const resolution = await StockVarianceResolution.findOneAndUpdate(
    { _id: id },
    {
      status: 'REVERSED',
      reversalProcessing: false,
      reversedBy: actingUser._id,
      reversedAt: now,
      reversalReason: reason,
      reversalInventoryTransactionId: reversalTxn._id,
    },
    { new: true }
  ).catch((finalizeErr) => {
    // eslint-disable-next-line no-console
    console.error('[STOCK_VARIANCE_REVERSAL_FINALIZE_FAILURE]', {
      id,
      reversalTransactionId: reversalTxn._id,
      finalizeErr,
    });
    throw ApiError.internal(
      'The reversal ledger effect was posted, but the resolution record could not be finalized. ' +
        'This requires manual review — see server logs for STOCK_VARIANCE_REVERSAL_FINALIZE_FAILURE.'
    );
  });

  // The resolution is now REVERSED — that status change alone already
  // excludes it from the ACTIVE-document aggregation that computes
  // user-facing "resolved"/"remaining" (see README "Source-of-truth
  // hierarchy"), regardless of what happens next. The coordination-cache
  // decrement below is best-effort bookkeeping only: never reserved (a
  // reservation is unrelated to a completed resolution being undone), and
  // a failure here must never fail the reversal itself, since the real
  // business-truth change (REVERSED + the opposing ledger entry) already
  // happened. There is exactly one coordination doc per report (never per
  // version — see model comment), so a plain dailySalesReportId match is
  // sufficient here.
  try {
    await DailyReportResolutionState.updateOne(
      { dailySalesReportId: resolution.dailySalesReportId },
      { $inc: { activeStockVarianceMagnitude: -resolution.quantity, version: 1 } }
    );
  } catch (coordErr) {
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
      reportId: resolution.dailySalesReportId,
      resolutionId: id,
      quantity: resolution.quantity,
      reason: 'coordination-state active decrement failed after resolution was marked REVERSED',
      coordErr,
    });
  }

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
