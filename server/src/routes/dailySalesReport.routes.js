import { Router } from 'express';
import {
  postDailySalesReport,
  getDailySalesReports,
  getDailySalesReportByIdHandler,
  getDailySummary,
} from '../controllers/dailySalesReport.controller.js';
import { requireAuth, requireRole, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createDailySalesReportSchema,
  idParamSchema,
  listDailySalesReportsQuerySchema,
  dailySummaryQuerySchema,
} from '../validators/dailySalesReport.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.post(
  '/',
  requireAuth,
  // ADMIN is deliberately excluded — Phase 3 keeps Phase 2's conservative
  // stance: ADMIN gets no new write capability without an explicit
  // permission architecture granting it (see README "Authorization").
  requireRole(ROLES.OWNER, ROLES.MANAGER, ROLES.SALESPERSON),
  validate(createDailySalesReportSchema),
  requireShopAccess('shopId', 'body'),
  postDailySalesReport
);

// Must be registered before GET '/:id' — otherwise Express would match
// "/summary" as an :id value.
router.get(
  '/summary',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(dailySummaryQuerySchema, 'query'),
  getDailySummary
);

router.get(
  '/',
  requireAuth,
  validate(listDailySalesReportsQuerySchema, 'query'),
  getDailySalesReports
);

router.get('/:id', requireAuth, validate(idParamSchema, 'params'), getDailySalesReportByIdHandler);

export default router;
