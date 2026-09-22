import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_VALUES } from '../utils/constants.js';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, required: true },
    // Shops this user is explicitly permitted to access. Ignored for OWNER,
    // who always has access to every shop (enforced in the auth middleware,
    // not by populating this array).
    shopIds: [{ type: Schema.Types.ObjectId, ref: 'Shop', default: [] }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ role: 1 });

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
};

// Defense in depth: even if a route forgets .select('-passwordHash'),
// JSON responses never leak the hash.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
