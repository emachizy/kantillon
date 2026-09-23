import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';

const safeMoneyInteger = z
  .number()
  .int('must be an integer')
  .refine((v) => Number.isSafeInteger(v), { message: 'must be a safe integer' });

const proposedSalesLineSchema = z.object({
  quantity: z.number().int('quantity must be a whole number of bags').positive(),
  unitPriceKobo: safeMoneyInteger.refine((v) => v > 0, { message: 'unitPriceKobo must be positive' }),
});

// Deliberately has no field for any server-calculated value — see the same
// comment on createDailySalesReportSchema. The proposed values represent
// the COMPLETE corrected report state, not a partial patch.
export const createCorrectionRequestSchema = z.object({
  reason: z.string().trim().min(1, 'A correction reason is required').max(500),
  proposedSalesLines: z
    .array(proposedSalesLineSchema)
    .min(1, 'At least one sales line is required')
    .max(20, 'A maximum of 20 sales lines is supported'),
  proposedPhysicalClosingStockQuantity: z.number().int().nonnegative(),
  proposedActualAmountCollectedKobo: safeMoneyInteger.refine((v) => v >= 0, {
    message: 'proposedActualAmountCollectedKobo must be non-negative',
  }),
  proposedNotes: z.string().trim().max(500).optional(),
});

export const rejectCorrectionRequestSchema = z.object({
  reason: z.string().trim().min(1, 'A rejection reason is required').max(500),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});
