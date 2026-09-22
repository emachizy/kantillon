import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';
import { STOCK_RECEIPT_STATUS_VALUES } from '../utils/constants.js';

// Deliberately has no "status" field — a client can never set a receipt's
// status through this schema, even by sending one; unknown keys are
// stripped by Zod's default object parsing before the controller sees them.
export const createStockReceiptSchema = z.object({
  shopId: objectIdSchema,
  productId: objectIdSchema,
  quantity: z.number().positive('Quantity must be greater than zero'),
  deliveryReference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const rejectStockReceiptSchema = z.object({
  reason: z.string().trim().min(1, 'A rejection reason is required').max(500),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const listStockReceiptsQuerySchema = z.object({
  shopId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  status: z.enum(STOCK_RECEIPT_STATUS_VALUES).optional(),
});
