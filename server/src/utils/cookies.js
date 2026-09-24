import { isProduction } from '../config/env.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Production serves the frontend and API from different origins
// (kantillon.onrender.com / kantillon-api.onrender.com), so the cookie
// must be SameSite=None to be sent on those cross-origin requests —
// browsers require Secure whenever SameSite=None is used. Locally both
// run on localhost, where Lax already works and Secure would require
// HTTPS we don't have in dev.
// `isProd` defaults to the real environment but can be overridden by
// tests to check both configurations without touching NODE_ENV.
export function getAuthCookieOptions(isProd = isProduction) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  };
}
