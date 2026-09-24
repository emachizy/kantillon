import { Shop } from '../models/Shop.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { isOwner, getAccessibleShopIds, canAccessShop } from './shopAccessService.js';

const SHOP_FIELDS = ['name', 'address', 'phone', 'notes'];

function snapshot(shop) {
  return { name: shop.name, address: shop.address, phone: shop.phone, notes: shop.notes };
}

// `code` is a required, unique identifier on the Shop model, but the OWNER
// never types one — the create API only asks for name/address/phone/notes
// (see validators/shop.validators.js). It is derived from the name and
// deduplicated here so a collision (e.g. two shops both named "Shop 1")
// never surfaces as a confusing unique-index error to the caller.
async function generateUniqueShopCode(name) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'SHOP';

  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Shop.exists({ code: candidate })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export async function createShop({ name, address, phone, notes, actingUser, req }) {
  const code = await generateUniqueShopCode(name);
  const shop = await Shop.create({ name, code, address, phone, notes });

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: shop._id,
    action: AUDIT_ACTIONS.SHOP_CREATED,
    entityType: 'Shop',
    entityId: shop._id,
    newValue: snapshot(shop),
  });

  return shop;
}

// OWNER always sees every shop they're permitted to see (all of them);
// `includeInactive` additionally is the only way an inactive shop is ever
// returned, and only OWNER can set it — every other role, and OWNER without
// the flag, only ever sees active shops. This mirrors the existing
// getAccessibleShopIds/canAccessShop split: role/shop scoping stays exactly
// as it was, active/inactive filtering is layered on top of it.
export async function listShops(user, { includeInactive = false } = {}) {
  const accessible = getAccessibleShopIds(user);
  const filter = accessible === 'ALL' ? {} : { _id: { $in: accessible } };

  if (!(isOwner(user) && includeInactive)) {
    filter.isActive = true;
  }

  return Shop.find(filter).sort({ name: 1 });
}

export async function getShopDetail(shopId, user) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw ApiError.notFound('Shop not found');
  if (!canAccessShop(user, shopId)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }
  return shop;
}

export async function updateShop({ id, updates, actingUser, req }) {
  const shop = await Shop.findById(id);
  if (!shop) throw ApiError.notFound('Shop not found');

  const previousValue = snapshot(shop);
  for (const field of SHOP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      shop[field] = updates[field];
    }
  }
  await shop.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: shop._id,
    action: AUDIT_ACTIONS.SHOP_UPDATED,
    entityType: 'Shop',
    entityId: shop._id,
    previousValue,
    newValue: snapshot(shop),
  });

  return shop;
}

export async function deactivateShop({ id, actingUser, req }) {
  const shop = await Shop.findById(id);
  if (!shop) throw ApiError.notFound('Shop not found');
  if (!shop.isActive) throw ApiError.conflict('Shop is already inactive');

  shop.isActive = false;
  await shop.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: shop._id,
    action: AUDIT_ACTIONS.SHOP_DEACTIVATED,
    entityType: 'Shop',
    entityId: shop._id,
  });

  return shop;
}

export async function reactivateShop({ id, actingUser, req }) {
  const shop = await Shop.findById(id);
  if (!shop) throw ApiError.notFound('Shop not found');
  if (shop.isActive) throw ApiError.conflict('Shop is already active');

  shop.isActive = true;
  await shop.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: shop._id,
    action: AUDIT_ACTIONS.SHOP_REACTIVATED,
    entityType: 'Shop',
    entityId: shop._id,
  });

  return shop;
}
