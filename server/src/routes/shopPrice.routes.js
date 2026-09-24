import { Router } from 'express';
import {
  getCurrentShopPriceHandler,
  postSetShopPriceHandler,
  getCurrentPricesForProductHandler,
  getCurrentPricesForShopHandler,
} from '../controllers/shopPrice.controller.js';
import { requireAuth, requireRole, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { currentShopPriceParamsSchema, setShopPriceSchema } from '../validators/shopPrice.validators.js';
import { shopIdParamSchema } from '../validators/userManagement.validators.js';
import { productIdParamSchema } from '../validators/product.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.get(
  '/shop/:shopId/product/:productId/current',
  requireAuth,
  validate(currentShopPriceParamsSchema, 'params'),
  requireShopAccess('shopId', 'params'),
  getCurrentShopPriceHandler
);

router.post('/', requireAuth, requireRole(ROLES.OWNER), validate(setShopPriceSchema), postSetShopPriceHandler);

router.get(
  '/product/:productId/current',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(productIdParamSchema, 'params'),
  getCurrentPricesForProductHandler
);

router.get(
  '/shop/:shopId/current',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(shopIdParamSchema, 'params'),
  getCurrentPricesForShopHandler
);

export default router;
