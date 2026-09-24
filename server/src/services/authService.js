import { findUserByEmail, findUserById } from './userService.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export async function authenticate(email, password) {
  const user = await findUserByEmail(email, { withPassword: true });
  // Same error for "no such user" and "wrong password" so login can't be used
  // to enumerate registered email addresses.
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return user;
}

// Self-service password change — the only path that lets a user (including
// the OWNER) change their own password, since
// userManagementService.resetUserPassword() explicitly refuses to touch an
// OWNER account. Always verifies the current password first, unlike an
// OWNER-driven reset.
export async function changeOwnPassword(userId, currentPassword, newPassword) {
  const user = await findUserById(userId, { withPassword: true });
  if (!user) throw ApiError.unauthorized();

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();

  return user;
}
