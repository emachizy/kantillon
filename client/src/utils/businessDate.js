// Mirrors server/src/utils/businessDate.js — the business day is always
// Africa/Lagos, never the browser's local timezone.
const LAGOS_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getTodayLagosBusinessDate() {
  return LAGOS_DATE_FORMATTER.format(new Date());
}
