import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';
import { MONEY_VARIANCE_RESOLUTION_TYPE_VALUES } from '../utils/constants.js';

const safeMoneyInteger = z
  .number()
  .int('must be an integer')
  .refine((v) => Number.isSafeInteger(v), { message: 'must be a safe integer' });

export const createMoneyVarianceResolutionSchema = z.object({
  resolutionType: z.enum(MONEY_VARIANCE_RESOLUTION_TYPE_VALUES),
  amountKobo: safeMoneyInteger.refine((v) => v > 0, { message: 'amountKobo must be positive' }),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
  notes: z.string().trim().max(500).optional(),
});

export const reverseMoneyVarianceResolutionSchema = z.object({
  reason: z.string().trim().min(1, 'A reversal reason is required').max(500),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});
