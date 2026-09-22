// Mirrors server/src/utils/money.js — money is always integer kobo on the
// wire and in calculations; Naira is only ever a display/input concern
// handled here via string manipulation, never float multiplication.

export function nairaInputToKobo(naira) {
  const str = String(naira).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid Naira amount: ${naira}`);
  }

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [whole, frac = ''] = unsigned.split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  const kobo = Number(whole) * 100 + Number(paddedFrac);

  return negative ? -kobo : kobo;
}

export function formatKoboAsNaira(kobo) {
  if (!Number.isSafeInteger(kobo)) return '—';
  const negative = kobo < 0;
  const abs = Math.abs(kobo);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  const wholeFormatted = whole.toLocaleString('en-NG');
  return `${negative ? '-' : ''}₦${wholeFormatted}.${String(cents).padStart(2, '0')}`;
}
