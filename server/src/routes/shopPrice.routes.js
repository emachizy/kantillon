import { Router } from 'express';
import { getCurrentShopPriceHandler } from '../controllers/shopPrice.controller.js';
import { requireAuth, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { currentShopPriceParamsSchema } from '../validators/shopPrice.validators.js';

const router = Router();

router.get(
  '/shop/:shopId/product/:productId/current',
  requireAuth,
  validate(currentShopPriceParamsSchema, 'params'),
  requireShopAccess('shopId', 'params'),
  getCurrentShopPriceHandler
);

export default router;
