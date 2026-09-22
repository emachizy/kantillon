import { z } from 'zod';
import { ROLE_VALUES } from '../utils/constants.js';
import { objectIdSchema } from './common.validators.js';

// Used by userService.createUser (called from the seed script today; wired
// up to an admin-only route in a later phase).
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  phone: z.string().trim().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(ROLE_VALUES),
  shopIds: z.array(objectIdSchema).optional().default([]),
  isActive: z.boolean().optional().default(true),
});
