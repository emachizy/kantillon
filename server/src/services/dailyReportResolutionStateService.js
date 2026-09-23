import { DailyReportResolutionState } from '../models/DailyReportResolutionState.js';

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

// The user-facing "actually resolved" amounts — ACTIVE only. A PROCESSING
// (reserved but not yet completed) resolution must never be presented to a
// user as resolved; see dailyReportCorrectionService.getEffectiveDailyReport().
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
// reservation is attempted. In normal operation this never finds a
// mismatch with non-zero counters — see the model comment for why — so
// this is a defensive backstop, not the primary mechanism. If it ever DID
// find one, resetting all four counters to zero is the only safe thing to
// do: an older effective version's leftover reserved/active magnitude must
// never reduce a newer correction's remaining discrepancy.
export async function syncResolutionStateToEffectiveVersion(reportId, currentEffectiveCorrectionId) {
  await ensureResolutionState(reportId);
  const targetId = normalizeId(currentEffectiveCorrectionId);
  const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
  const stateId = normalizeId(state.effectiveCorrectionId);

  if (stateId === targetId) {
    return state;
  }

  const hasLeftoverMagnitude =
    state.reservedStockVarianceMagnitude > 0 ||
    state.activeStockVarianceMagnitude > 0 ||
    state.reservedMoneyVarianceMagnitudeKobo > 0 ||
    state.activeMoneyVarianceMagnitudeKobo > 0;

  if (hasLeftoverMagnitude) {
    // This should be unreachable given the correction-approval gate — log
    // loudly so it gets manual attention rather than silently resetting.
    // eslint-disable-next-line no-console
    console.error('[RESOLUTION_STATE_STALE_VERSION]', {
      reportId,
      staleEffectiveCorrectionId: state.effectiveCorrectionId,
      newEffectiveCorrectionId: currentEffectiveCorrectionId,
      reservedStockVarianceMagnitude: state.reservedStockVarianceMagnitude,
      activeStockVarianceMagnitude: state.activeStockVarianceMagnitude,
      reservedMoneyVarianceMagnitudeKobo: state.reservedMoneyVarianceMagnitudeKobo,
      activeMoneyVarianceMagnitudeKobo: state.activeMoneyVarianceMagnitudeKobo,
    });
  }

  await DailyReportResolutionState.updateOne(
    { _id: state._id },
    {
      $set: {
        effectiveCorrectionId: currentEffectiveCorrectionId ?? null,
        reservedStockVarianceMagnitude: 0,
        activeStockVarianceMagnitude: 0,
        reservedMoneyVarianceMagnitudeKobo: 0,
        activeMoneyVarianceMagnitudeKobo: 0,
      },
      $inc: { version: 1 },
    }
  );

  return DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
}
