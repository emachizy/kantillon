import { isProduction } from '../config/env.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// SameSite=lax + secure-in-production is a reasonable default for a
// same-site (or same-organization) SPA talking to this API via cookies.
export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  };
}
