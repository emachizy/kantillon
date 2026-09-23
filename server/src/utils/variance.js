// Shared sign-preserving "remaining discrepancy" math, used by both stock
// and money variance resolution services and by getEffectiveDailyReport().
//
//   remaining magnitude = ABS(effectiveVariance) - resolvedMagnitude
//   remaining = remaining magnitude, with effectiveVariance's original sign
//
// This is a read/display helper only — the actual "don't over-resolve"
// guarantee under concurrency comes from the atomic conditional update in
// the resolution services (see their comments), not from this function.
export function computeRemainingSigned(effectiveVariance, resolvedMagnitude) {
  if (effectiveVariance === 0) return 0;
  const remainingMagnitude = Math.abs(effectiveVariance) - resolvedMagnitude;
  return effectiveVariance < 0 ? -remainingMagnitude : remainingMagnitude;
}
