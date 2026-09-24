import { z } from 'zod';

// Only fields the Shop model actually has are ever accepted — `.strict()`
// rejects anything else outright (e.g. code, isActive, managerId, _id)
// rather than silently dropping it. `code` is never client-supplied: it is
// generated server-side (see services/shopService.js) so the OWNER never
// has to think about a second identifier alongside the shop name.
export const createShopSchema = z
  .object({
    name: z.string().trim().min(1, 'Shop name is required').max(120, 'Shop name is too long'),
    address: z.string().trim().max(300, 'Address is too long').optional(),
    phone: z.string().trim().max(30, 'Phone is too long').optional(),
    notes: z.string().trim().max(1000, 'Notes are too long').optional(),
  })
  .strict();

export const updateShopSchema = z
  .object({
    name: z.string().trim().min(1, 'Shop name is required').max(120, 'Shop name is too long').optional(),
    address: z.string().trim().max(300, 'Address is too long').optional(),
    phone: z.string().trim().max(30, 'Phone is too long').optional(),
    notes: z.string().trim().max(1000, 'Notes are too long').optional(),
  })
  .strict();

// OWNER-only mode (enforced in the service, not here) that also returns
// deactivated shops, so they can be found and reactivated from the
// management UI. Every other role always sees active shops only.
export const listShopsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
