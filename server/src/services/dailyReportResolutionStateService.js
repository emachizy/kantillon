import { DailyReportResolutionState } from '../models/DailyReportResolutionState.js';
import { ApiError } from '../utils/ApiError.js';

function normalizeId(id) {
  return id ? id.toString() : null;
}

// Idempotent "make sure the coordination doc exists" step. Safe to call
// concurrently — a duplicate-key race on the unique dailySalesReportId
// index just means another concurrent caller already created it.
export async function ensureResolutionState(reportId) {
  try {
    await DailyReportResolutionState.create({ dailySalesReportId: reportId });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

// Read-only: ALL FOUR counters plus the version they belong to, or zero if
// no resolution has ever been attempted against this report (no document
// created yet). Never creates a document — pure read. Callers that only
// care about the user-facing "actually resolved" amount should use
// getActiveMagnitudes() instead — this is for internal reservation logic.
export async function getRawMagnitudes(reportId) {
  const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId }).select(
    'reservedStockVarianceMagnitude activeStockVarianceMagnitude ' +
      'reservedMoneyVarianceMagnitudeKobo activeMoneyVarianceMagnitudeKobo effectiveCorrectionId'
  );
  return {
    reservedStockVarianceMagnitude: state?.reservedStockVarianceMagnitude ?? 0,
    activeStockVarianceMagnitude: state?.activeStockVarianceMagnitude ?? 0,
    reservedMoneyVarianceMagnitudeKobo: state?.reservedMoneyVarianceMagnitudeKobo ?? 0,
    activeMoneyVarianceMagnitudeKobo: state?.activeMoneyVarianceMagnitudeKobo ?? 0,
    effectiveCorrectionId: state?.effectiveCorrectionId ?? null,
  };
}

// IMPORTANT: activeStockVarianceMagnitude / activeMoneyVarianceMagnitudeKobo
// are a CONCURRENCY-COORDINATION CACHE, not the business-truth record of
// what was resolved. That truth is the set of StockVarianceResolution /
// MoneyVarianceResolution documents with status ACTIVE for the current
// effective version — see dailyReportCorrectionService.js
// getActiveStockResolutionMagnitude() / getActiveMoneyResolutionMagnitude(),
// which aggregate those documents directly and are what
// getEffectiveDailyReport() actually displays to users. This function (and
// the raw counters it reads) exists ONLY to make the atomic
// reserved+active+requested <= |variance| concurrency check possible
// without a read-then-write race window. If this cache ever disagrees with
// the true ACTIVE-document sum, that is a divergence to log and reconcile
// manually — never a reason to silently rewrite historical resolution
// records, and never a reason to trust this cache over the real documents
// for a user-facing number.
export async function getActiveMagnitudes(reportId) {
  const raw = await getRawMagnitudes(reportId);
  return {
    activeStockVarianceMagnitude: raw.activeStockVarianceMagnitude,
    activeMoneyVarianceMagnitudeKobo: raw.activeMoneyVarianceMagnitudeKobo,
    reservedStockVarianceMagnitude: raw.reservedStockVarianceMagnitude,
    reservedMoneyVarianceMagnitudeKobo: raw.reservedMoneyVarianceMagnitudeKobo,
    effectiveCorrectionId: raw.effectiveCorrectionId,
  };
}

// A correction must be blocked while there is ANY resolution activity in
// flight or completed against the effective version — not just ACTIVE ones.
// A PROCESSING reservation still represents a claim against this report's
// variance that a correction would otherwise silently invalidate.
export async function hasAnyResolutionActivity(reportId) {
  const raw = await getRawMagnitudes(reportId);
  return (
    raw.reservedStockVarianceMagnitude > 0 ||
    raw.activeStockVarianceMagnitude > 0 ||
    raw.reservedMoneyVarianceMagnitudeKobo > 0 ||
    raw.activeMoneyVarianceMagnitudeKobo > 0
  );
}

// Make sure the coordination doc's effectiveCorrectionId matches the
// version currently being resolved against, before a new resolution
// reservation is attempted (or before a newly-approved correction takes
// over as the effective version). This FAILS CLOSED:
//
//   CASE A — state.effectiveCorrectionId already matches: return normally,
//   nothing to do.
//
//   CASE B — the effective version differs, AND all four counters are
//   zero: safe to update effectiveCorrectionId — there is nothing to lose,
//   since a correction can only be approved while
//   hasAnyResolutionActivity() is false (all four counters zero).
//
//   CASE C — the effective version differs, AND any counter is non-zero:
//   this must be treated as a genuine data-integrity divergence, NEVER as
//   "stale state to reset." Resetting here would silently make a
//   crash-stranded PROCESSING reservation (or worse, an ACTIVE resolution)
//   disappear from tracking just because the effective version moved on.
//   Log loudly and throw — this requires manual review, not an automatic
//   reset. See README "Effective-version fail-closed behavior".
//
//   CASE D — the effective version differs, all counters are zero, BUT
//   correctionProcessing is currently held (by definition, by some OTHER
//   request — the holder itself never reaches this generic function to
//   switch versions; it uses releaseCorrectionProcessingLockWithNewVersion(),
//   which matches on its own correctionProcessingRequestId instead). Fail
//   closed exactly like CASE C: a correction is mid-approval and this
//   function must never race ahead of it.
export async function syncResolutionStateToEffectiveVersion(reportId, currentEffectiveCorrectionId) {
  await ensureResolutionState(reportId);
  const targetId = normalizeId(currentEffectiveCorrectionId);
  const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
  const stateId = normalizeId(state.effectiveCorrectionId);

  if (stateId === targetId) {
    return state; // CASE A
  }

  const hasLeftoverMagnitude =
    state.reservedStockVarianceMagnitude > 0 ||
    state.activeStockVarianceMagnitude > 0 ||
    state.reservedMoneyVarianceMagnitudeKobo > 0 ||
    state.activeMoneyVarianceMagnitudeKobo > 0;

  if (hasLeftoverMagnitude || state.correctionProcessing) {
    // CASE C / CASE D — fail closed. This should be unreachable given the
    // correction-approval gate (hasAnyResolutionActivity /
    // claimCorrectionProcessingLock), so reaching this branch means that
    // gate was bypassed by a genuine race or bug.
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_VERSION_DIVERGENCE]', {
      reportId,
      oldEffectiveCorrectionId: state.effectiveCorrectionId,
      requestedEffectiveCorrectionId: currentEffectiveCorrectionId,
      reservedStockVarianceMagnitude: state.reservedStockVarianceMagnitude,
      activeStockVarianceMagnitude: state.activeStockVarianceMagnitude,
      reservedMoneyVarianceMagnitudeKobo: state.reservedMoneyVarianceMagnitudeKobo,
      activeMoneyVarianceMagnitudeKobo: state.activeMoneyVarianceMagnitudeKobo,
      correctionProcessing: state.correctionProcessing,
      correctionProcessingRequestId: state.correctionProcessingRequestId,
    });
    throw ApiError.internal(
      'Resolution coordination state has non-zero reserved/active magnitude (or an in-flight ' +
        'correction lock) against a stale effective version. This is an unexpected workflow-state ' +
        'divergence and must be reconciled manually — see server logs for ' +
        'RESOLUTION_STATE_VERSION_DIVERGENCE. Nothing was reset.'
    );
  }

  // CASE B — safe: nothing to lose.
  await DailyReportResolutionState.updateOne(
    { _id: state._id },
    {
      $set: {
        effectiveCorrectionId: currentEffectiveCorrectionId ?? null,
      },
      $inc: { version: 1 },
    }
  );

  return DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
}

// Atomically claims the shared correction/resolution lock — the ONLY way a
// correction approval may proceed to build its ledger effects. Matches
// (and thus only succeeds) when: effectiveCorrectionId is still the
// version this correction was requested against, the lock is free, and
// ALL FOUR reserved/active counters are zero. This closes the race where a
// stock/money resolution reserves against the current version between a
// correction's earlier "is anything active?" read and its actual approval.
export async function claimCorrectionProcessingLock(reportId, expectedEffectiveCorrectionId, correctionRequestId) {
  await ensureResolutionState(reportId);
  const claimed = await DailyReportResolutionState.findOneAndUpdate(
    {
      dailySalesReportId: reportId,
      effectiveCorrectionId: expectedEffectiveCorrectionId ?? null,
      correctionProcessing: false,
      reservedStockVarianceMagnitude: 0,
      activeStockVarianceMagnitude: 0,
      reservedMoneyVarianceMagnitudeKobo: 0,
      activeMoneyVarianceMagnitudeKobo: 0,
    },
    {
      $set: { correctionProcessing: true, correctionProcessingRequestId: correctionRequestId },
      $inc: { version: 1 },
    },
    { new: true }
  );

  if (!claimed) {
    throw ApiError.conflict(
      'Cannot approve this correction right now: a stock or money variance resolution is active or ' +
        'in flight for this report, or another correction is already being processed. Try again once ' +
        'it clears.'
    );
  }

  return claimed;
}

// Releases the lock WITHOUT changing effectiveCorrectionId — used when
// correction construction fails after the lock was claimed (normal caught
// failure path). Matches on correctionProcessingRequestId so only the
// actual lock holder can release it.
export async function releaseCorrectionProcessingLockOnFailure(reportId, correctionRequestId) {
  await DailyReportResolutionState.updateOne(
    { dailySalesReportId: reportId, correctionProcessingRequestId: correctionRequestId },
    { $set: { correctionProcessing: false, correctionProcessingRequestId: null }, $inc: { version: 1 } }
  );
}

// Releases the lock AND switches effectiveCorrectionId to the newly-approved
// correction, in one atomic update, matched on correctionProcessingRequestId
// (only the lock holder may do this). A failure here does NOT mean the
// correction itself is invalid — it's already real and committed by this
// point — so this never throws; a failure is logged as
// [RESOLUTION_STATE_CACHE_DIVERGENCE] (the lock staying stranded true is a
// manual-review state, same spirit as a crash-stranded PROCESSING
// resolution) rather than surfaced as an API error.
export async function releaseCorrectionProcessingLockWithNewVersion(reportId, correctionRequestId, newEffectiveCorrectionId) {
  try {
    const result = await DailyReportResolutionState.updateOne(
      { dailySalesReportId: reportId, correctionProcessingRequestId: correctionRequestId },
      {
        $set: {
          effectiveCorrectionId: newEffectiveCorrectionId,
          correctionProcessing: false,
          correctionProcessingRequestId: null,
        },
        $inc: { version: 1 },
      }
    );
    if (result.matchedCount === 0) {
      // eslint-disable-next-line no-console
      console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
        reportId,
        correctionRequestId,
        newEffectiveCorrectionId,
        reason: 'no coordination doc held this correctionProcessingRequestId at release time',
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_CACHE_DIVERGENCE]', {
      reportId,
      correctionRequestId,
      newEffectiveCorrectionId,
      reason: 'lock release + version switch failed after correction was already committed',
      err,
    });
  }
}
