import { z } from 'zod';
import { objectIdSchema } from './common.validators.js';

export const currentShopPriceParamsSchema = z.object({
  shopId: objectIdSchema,
  productId: objectIdSchema,
});
