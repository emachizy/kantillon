import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';

export const openingStockSchema = z.object({
  shopId: objectIdSchema,
  productId: objectIdSchema,
  quantity: z.number().positive('Quantity must be greater than zero'),
  notes: z.string().trim().max(500).optional(),
});

export const shopIdParamSchema = z.object({
  shopId: objectIdSchema,
});
