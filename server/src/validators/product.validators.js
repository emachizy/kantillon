import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';

// `sku` is never client-supplied — like Shop's `code`, it is generated
// server-side (see services/productService.js) so the OWNER only ever
// thinks about the product name. `unit` is required by the model but
// optional here with a sensible default, since most of today's catalog is
// bag-based; a future non-bag product can simply supply its own unit.
export const createProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(120, 'Product name is too long'),
    unit: z.string().trim().min(1, 'Unit is required').max(30, 'Unit is too long').optional().default('bag'),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required').max(120, 'Product name is too long').optional(),
    unit: z.string().trim().min(1, 'Unit is required').max(30, 'Unit is too long').optional(),
  })
  .strict();

// OWNER-only mode (enforced in the service, not here) that also returns
// deactivated products, so they can be found and reactivated from the
// management UI. Every other role always sees active products only.
export const listProductsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const productIdParamSchema = z.object({
  productId: objectIdSchema,
});
