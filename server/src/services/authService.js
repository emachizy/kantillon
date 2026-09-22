import { findUserByEmail } from './userService.js';
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
