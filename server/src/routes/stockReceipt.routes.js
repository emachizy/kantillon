import { Router } from 'express';
import {
  postStockReceipt,
  getPendingStockReceipts,
  postApproveStockReceipt,
  postRejectStockReceipt,
  getStockReceiptHistory,
} from '../controllers/stockReceipt.controller.js';
import { requireAuth, requireRole, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createStockReceiptSchema,
  rejectStockReceiptSchema,
  idParamSchema,
  listStockReceiptsQuerySchema,
} from '../validators/stockReceipt.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.post(
  '/',
  requireAuth,
  requireRole(ROLES.OWNER, ROLES.MANAGER, ROLES.SALESPERSON),
  validate(createStockReceiptSchema),
  requireShopAccess('shopId', 'body'),
  postStockReceipt
);

router.get('/pending', requireAuth, requireRole(ROLES.OWNER), getPendingStockReceipts);

router.get('/', requireAuth, validate(listStockReceiptsQuerySchema, 'query'), getStockReceiptHistory);

router.post(
  '/:id/approve',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  postApproveStockReceipt
);

router.post(
  '/:id/reject',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(rejectStockReceiptSchema),
  postRejectStockReceipt
);

export default router;
