import { Router } from 'express';
import { postOpeningStock, getShopInventoryHandler } from '../controllers/inventory.controller.js';
import { requireAuth, requireRole, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { openingStockSchema, shopIdParamSchema } from '../validators/inventory.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.post(
  '/opening-stock',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(openingStockSchema),
  postOpeningStock
);

router.get(
  '/shop/:shopId',
  requireAuth,
  validate(shopIdParamSchema, 'params'),
  requireShopAccess('shopId', 'params'),
  getShopInventoryHandler
);

export default router;
