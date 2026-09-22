import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export async function findUserByEmail(email, { withPassword = false } = {}) {
  const query = User.findOne({ email: email.toLowerCase() });
  if (withPassword) query.select('+passwordHash');
  return query.exec();
}

export async function findUserById(id) {
  return User.findById(id);
}

// The one place a User document is created. Used by the seed script now;
// intended to back an admin-only "create user" route in a later phase.
export async function createUser({ name, email, phone, password, role, shopIds = [], isActive = true }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw ApiError.conflict('A user with this email already exists');
  }

  const passwordHash = await User.hashPassword(password);

  return User.create({
    name,
    email: email.toLowerCase(),
    phone,
    passwordHash,
    role,
    shopIds,
    isActive,
  });
}
