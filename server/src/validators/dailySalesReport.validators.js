import { z } from 'zod';
import { objectIdSchema, businessDateSchema } from './common.validators.js';

const safeMoneyInteger = z
  .number()
  .int('must be an integer')
  .refine((v) => Number.isSafeInteger(v), { message: 'must be a safe integer' });

const salesLineSchema = z.object({
  quantity: z.number().int('quantity must be a whole number of bags').positive(),
  unitPriceKobo: safeMoneyInteger.refine((v) => v > 0, { message: 'unitPriceKobo must be positive' }),
});

// Deliberately has no field for any server-calculated value
// (expectedRevenueKobo, stockVarianceQuantity, moneyVarianceKobo,
// openingStockQuantity, totalQuantitySold, status, submittedBy, ...) — a
// client sending any of those gets it silently stripped by Zod before the
// controller/service ever sees it. Every one of those is computed in
// dailySalesReportService.js from salesLines + the ledger, never trusted
// from the request.
export const createDailySalesReportSchema = z.object({
  shopId: objectIdSchema,
  productId: objectIdSchema,
  businessDate: businessDateSchema,
  salesLines: z
    .array(salesLineSchema)
    .min(1, 'At least one sales line is required')
    .max(20, 'A maximum of 20 sales lines is supported'),
  physicalClosingStockQuantity: z.number().int().nonnegative(),
  actualAmountCollectedKobo: safeMoneyInteger.refine((v) => v >= 0, {
    message: 'actualAmountCollectedKobo must be non-negative',
  }),
  notes: z.string().trim().max(500).optional(),
});

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const listDailySalesReportsQuerySchema = z.object({
  shopId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  businessDate: businessDateSchema.optional(),
});

export const dailySummaryQuerySchema = z.object({
  businessDate: businessDateSchema,
});
