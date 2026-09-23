import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';
import { STOCK_VARIANCE_RESOLUTION_TYPE_VALUES } from '../utils/constants.js';

// Deliberately has no "direction" field — the server derives it from
// resolutionType (DAMAGE/SHORTAGE -> OUT, SURPLUS -> IN) and never trusts a
// client-supplied direction.
export const createStockVarianceResolutionSchema = z.object({
  resolutionType: z.enum(STOCK_VARIANCE_RESOLUTION_TYPE_VALUES),
  quantity: z.number().int('quantity must be a whole number of bags').positive(),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
  notes: z.string().trim().max(500).optional(),
});

export const reverseStockVarianceResolutionSchema = z.object({
  reason: z.string().trim().min(1, 'A reversal reason is required').max(500),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});
