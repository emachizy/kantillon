import { env } from '../config/env.js';
import { verifyAuthToken } from '../utils/token.js';
import { findUserById } from '../services/userService.js';
import { canAccessShop } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { catchAsync } from '../utils/catchAsync.js';

export const requireAuth = catchAsync(async (req, _res, next) => {
  const token = req.cookies?.[env.cookieName];
  if (!token) {
    throw ApiError.unauthorized();
  }

  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const user = await findUserById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  req.user = user;
  next();
});

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden());
    }
    next();
  };
}

// Checks req.params[fieldName] (or req.body[fieldName] when source is
// "body") against the caller's permitted shops. Never trust a shopId
// supplied by the client without this — run it after validate() so the id
// is already a well-formed ObjectId string by the time it's checked.
export function requireShopAccess(fieldName = 'shopId', source = 'params') {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const shopId = source === 'body' ? req.body[fieldName] : req.params[fieldName];
    if (!shopId) return next(ApiError.badRequest(`Missing ${fieldName}`));
    if (!canAccessShop(req.user, shopId)) {
      return next(ApiError.forbidden('You do not have access to this shop'));
    }
    next();
  };
}
