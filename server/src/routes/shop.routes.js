import { Router } from 'express';
import {
  listShops,
  postCreateShop,
  getShopByIdHandler,
  patchShopHandler,
  postDeactivateShop,
  postReactivateShop,
  getShopStaffHandler,
} from '../controllers/shop.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { shopIdParamSchema } from '../validators/userManagement.validators.js';
import { createShopSchema, updateShopSchema, listShopsQuerySchema } from '../validators/shop.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.get('/', requireAuth, validate(listShopsQuerySchema, 'query'), listShops);
router.post('/', requireAuth, requireRole(ROLES.OWNER), validate(createShopSchema), postCreateShop);

router.get('/:shopId', requireAuth, validate(shopIdParamSchema, 'params'), getShopByIdHandler);
router.patch(
  '/:shopId',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(shopIdParamSchema, 'params'),
  validate(updateShopSchema),
  patchShopHandler
);

router.post(
  '/:shopId/deactivate',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(shopIdParamSchema, 'params'),
  postDeactivateShop
);
router.post(
  '/:shopId/reactivate',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(shopIdParamSchema, 'params'),
  postReactivateShop
);

router.get(
  '/:shopId/staff',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(shopIdParamSchema, 'params'),
  getShopStaffHandler
);

export default router;
