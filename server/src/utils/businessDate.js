// The business timezone is fixed to Africa/Lagos regardless of what
// timezone the server process itself runs in — never use `new
// Date().toISOString().slice(0,10)` or similar server-local-time logic for
// a business date. Lagos has no DST (fixed UTC+1 year-round), but we still
// go through Intl rather than hardcoding an offset, since that's the
// correct general approach and costs nothing.
const LAGOS_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Returns the canonical YYYY-MM-DD business date for the given instant
// (defaults to now), as observed in Africa/Lagos.
export function getLagosBusinessDate(date = new Date()) {
  return LAGOS_DATE_FORMATTER.format(date);
}

export function isValidBusinessDateFormat(value) {
  if (typeof value !== 'string' || !BUSINESS_DATE_PATTERN.test(value)) return false;
  // Reject calendar-invalid dates like 2026-02-30: round-tripping through
  // Date and reformatting must reproduce the same string.
  const [year, month, day] = value.split('-').map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

// YYYY-MM-DD strings sort correctly with plain string comparison.
export function compareBusinessDates(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isFutureBusinessDate(businessDate, referenceDate = new Date()) {
  return compareBusinessDates(businessDate, getLagosBusinessDate(referenceDate)) > 0;
}
