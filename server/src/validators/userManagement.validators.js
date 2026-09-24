import { z } from 'zod';
import { ASSIGNABLE_STAFF_ROLES, ROLE_VALUES } from '../utils/constants.js';
import { objectIdSchema } from './common.validators.js';

// Staff creation only ever accepts ADMIN/MANAGER/SALESPERSON — OWNER is
// deliberately excluded (see README "Who may create another OWNER"). The
// field is named shopIds, matching the User model directly — Kantillon
// does not maintain a second "assignedShopIds" concept alongside it.
export const createStaffUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  phone: z.string().trim().optional(),
  role: z.enum(ASSIGNABLE_STAFF_ROLES, {
    errorMap: () => ({ message: `Role must be one of: ${ASSIGNABLE_STAFF_ROLES.join(', ')}` }),
  }),
  shopIds: z.array(objectIdSchema).optional().default([]),
  temporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters'),
});

// PATCH /api/users/:id — an explicit allow-list, never a raw document
// update. Every field is optional (a caller may update just one), but no
// field outside this list is ever accepted, and .strict() rejects any
// unrecognized key outright (e.g. passwordHash, createdAt, _id) rather than
// silently dropping it.
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').optional(),
    role: z.enum(ASSIGNABLE_STAFF_ROLES, {
      errorMap: () => ({ message: `Role must be one of: ${ASSIGNABLE_STAFF_ROLES.join(', ')}` }),
    }).optional(),
    shopIds: z.array(objectIdSchema).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const resetPasswordSchema = z.object({
  newTemporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters'),
});

export const listUsersQuerySchema = z.object({
  role: z.enum(ROLE_VALUES).optional(),
  shopId: objectIdSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().trim().min(1).optional(),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const shopIdParamSchema = z.object({
  shopId: objectIdSchema,
});
