import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const authRateLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  // The automated test suite logs in far more often per minute than any
  // real client would (each test needs a fresh user after clearTestDb), so
  // it would otherwise trip this limiter well before finishing a file. This
  // never applies in development/production — only NODE_ENV=test skips it.
  skip: () => env.nodeEnv === 'test',
});
