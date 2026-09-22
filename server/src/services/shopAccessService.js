import { ROLES } from '../utils/constants.js';

// Single reusable source of truth for "which shops can this user see/act on".
// Every route/controller that filters or checks shop access should go
// through these two functions rather than re-implementing the OWNER-bypass
// logic inline.

export function isOwner(user) {
  return user.role === ROLES.OWNER;
}

// Returns 'ALL' (owner — no filtering needed) or an array of shop id strings
// the user is permitted to access.
export function getAccessibleShopIds(user) {
  if (isOwner(user)) return 'ALL';
  return (user.shopIds || []).map((id) => id.toString());
}

export function canAccessShop(user, shopId) {
  if (isOwner(user)) return true;
  const accessible = getAccessibleShopIds(user);
  return accessible.includes(shopId.toString());
}
