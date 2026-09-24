import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';

export const currentShopPriceParamsSchema = z.object({
  shopId: objectIdSchema,
  productId: objectIdSchema,
});

// priceKobo must be a positive integer — no Naira floats ever cross the
// wire. z.number().int() alone already rejects fractional kobo (e.g.
// 750.5); .positive() rejects zero/negative on top of that.
export const setShopPriceSchema = z
  .object({
    shopId: objectIdSchema,
    productId: objectIdSchema,
    priceKobo: z.number().int('priceKobo must be a whole number').positive('priceKobo must be greater than zero'),
  })
  .strict();
