// All money is stored and calculated as integer kobo (1 Naira = 100 kobo).
// Never use floating-point Naira in a calculation — a plain "parseFloat(x) *
// 100" can misround values like 12.15 due to binary floating-point
// representation. Where a Naira string must be converted, do it via string
// manipulation (see nairaToKobo) rather than float multiplication.

const MAX_SAFE_MONEY_KOBO = Number.MAX_SAFE_INTEGER;

export function isSafeMoneyInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_MONEY_KOBO;
}

// Converts a Naira amount (number or numeric string, at most 2 decimal
// places) to an integer kobo amount without any floating-point
// multiplication. Throws on malformed input rather than silently rounding.
export function nairaToKobo(naira) {
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

// Converts integer kobo to a plain Naira decimal string ("12000.00"),
// again via integer arithmetic rather than float division.
export function koboToNairaString(kobo) {
  if (!Number.isSafeInteger(kobo)) {
    throw new Error(`Invalid kobo amount: ${kobo}`);
  }
  const negative = kobo < 0;
  const abs = Math.abs(kobo);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${negative ? '-' : ''}${whole}.${String(cents).padStart(2, '0')}`;
}
