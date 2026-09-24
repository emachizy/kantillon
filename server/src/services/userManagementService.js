import { User } from '../models/User.js';
import { Shop } from '../models/Shop.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS, ROLES } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { createUser } from './userService.js';

// Fields safe to return from every staff-management endpoint. passwordHash
// is never included — it's select:false on the schema, and toJSON strips
// it too as a second layer of defense (see models/User.js).
const USER_SELECT = 'name email phone role shopIds isActive mustChangePassword createdAt updatedAt';

// Never trusts a client-supplied shop id blindly — every id must reference
// a real Shop document before it's written onto a user. Assigning a
// currently-inactive shop is deliberately still allowed (an OWNER may want
// to prepare a staff assignment before reactivating a shop); only a
// nonexistent shop id is rejected.
async function assertShopsExist(shopIds) {
  if (!shopIds || shopIds.length === 0) return;
  const uniqueIds = [...new Set(shopIds.map(String))];
  const count = await Shop.countDocuments({ _id: { $in: uniqueIds } });
  if (count !== uniqueIds.length) {
    throw ApiError.badRequest('One or more assigned shops do not exist');
  }
}

// The only way a staff account (ADMIN/MANAGER/SALESPERSON) is created
// through the running application — OWNER accounts are never created here;
// see utils/constants.js ASSIGNABLE_STAFF_ROLES and the validator that
// enforces it before this function ever runs. Reuses userService.createUser
// (the one place a User document is created) rather than duplicating that
// logic, and layers the staff-specific mustChangePassword flag on top.
export async function createStaffUser({ name, email, phone, role, shopIds, temporaryPassword, actingUser, req }) {
  await assertShopsExist(shopIds);

  const user = await createUser({
    name,
    email,
    phone,
    password: temporaryPassword,
    role,
    shopIds,
  });
  user.mustChangePassword = true;
  await user.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'User',
    entityId: user._id,
    newValue: { name: user.name, email: user.email, role: user.role, shopIds: user.shopIds },
  });

  const created = await User.findById(user._id).select(USER_SELECT).populate('shopIds', 'name code');
  return created;
}

export async function listUsers({ role, shopId, isActive, search } = {}) {
  const filter = {};
  if (role) filter.role = role;
  if (shopId) filter.shopIds = shopId;
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  return User.find(filter).select(USER_SELECT).populate('shopIds', 'name code').sort({ createdAt: -1 });
}

export async function getUserDetail(id) {
  const user = await User.findById(id).select(USER_SELECT).populate('shopIds', 'name code');
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

// PATCH /api/users/:id. `updates` has already been through
// validators/userManagement.validators.js updateUserSchema — an explicit
// allow-list (name/role/shopIds/isActive) with unknown keys rejected, so
// there is no risk of this ever writing passwordHash/createdAt/_id from a
// request body. Business rules layered on top of that:
//   - the OWNER account can never be modified through this endpoint at
//     all (this also covers "OWNER cannot demote/deactivate self" for
//     free, since the acting OWNER can never appear as a non-OWNER target
//     — see README "Owner must not lock themselves out").
//   - role changes are restricted to ADMIN/MANAGER/SALESPERSON by the
//     validator already; there is nothing further to enforce here.
export async function updateUser({ id, updates, actingUser, req }) {
  const target = await User.findById(id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === ROLES.OWNER) {
    throw ApiError.forbidden('The OWNER account cannot be modified through staff management');
  }

  if (updates.shopIds) {
    await assertShopsExist(updates.shopIds);
  }

  const previousValue = {
    name: target.name,
    role: target.role,
    shopIds: target.shopIds,
    isActive: target.isActive,
  };

  Object.assign(target, updates);
  await target.save();

  const onlyShopsChanged = Object.keys(updates).every((key) => key === 'shopIds');
  await recordAudit({
    req,
    userId: actingUser._id,
    action: onlyShopsChanged ? AUDIT_ACTIONS.USER_SHOPS_UPDATED : AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'User',
    entityId: target._id,
    previousValue,
    newValue: { name: target.name, role: target.role, shopIds: target.shopIds, isActive: target.isActive },
  });

  const updated = await User.findById(target._id).select(USER_SELECT).populate('shopIds', 'name code');
  return updated;
}

export async function deactivateUser({ id, actingUser, req }) {
  const target = await User.findById(id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === ROLES.OWNER) {
    throw ApiError.forbidden('The OWNER account cannot be deactivated');
  }
  if (!target.isActive) {
    throw ApiError.conflict('User is already inactive');
  }

  target.isActive = false;
  await target.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.USER_DEACTIVATED,
    entityType: 'User',
    entityId: target._id,
  });

  return User.findById(target._id).select(USER_SELECT).populate('shopIds', 'name code');
}

export async function reactivateUser({ id, actingUser, req }) {
  const target = await User.findById(id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.isActive) {
    throw ApiError.conflict('User is already active');
  }

  target.isActive = true;
  await target.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.USER_REACTIVATED,
    entityType: 'User',
    entityId: target._id,
  });

  return User.findById(target._id).select(USER_SELECT).populate('shopIds', 'name code');
}

// Sets a new temporary password and flags the account to require a change
// on next login — never returns the password, never returns passwordHash,
// and cannot be used against the OWNER account (an OWNER changes their own
// password through the self-service /api/auth/change-password endpoint,
// which requires knowing the current password).
export async function resetUserPassword({ id, newTemporaryPassword, actingUser, req }) {
  const target = await User.findById(id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === ROLES.OWNER) {
    throw ApiError.forbidden('Cannot reset the OWNER password through staff management');
  }

  target.passwordHash = await User.hashPassword(newTemporaryPassword);
  target.mustChangePassword = true;
  await target.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: 'User',
    entityId: target._id,
  });

  return User.findById(target._id).select(USER_SELECT).populate('shopIds', 'name code');
}

export async function listShopStaff(shopId) {
  const shop = await Shop.findById(shopId);
  if (!shop) throw ApiError.notFound('Shop not found');
  return User.find({ shopIds: shopId }).select(USER_SELECT).populate('shopIds', 'name code').sort({ name: 1 });
}
