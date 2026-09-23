import { Router } from 'express';
import {
  postDailySalesReport,
  getDailySalesReports,
  getDailySalesReportByIdHandler,
  getDailySummary,
} from '../controllers/dailySalesReport.controller.js';
import {
  postCorrectionRequest,
  getCorrectionsForReport,
  getEffectiveReport,
} from '../controllers/dailyReportCorrection.controller.js';
import {
  postStockVarianceResolution,
  getStockVarianceResolutionsForReport,
} from '../controllers/stockVarianceResolution.controller.js';
import {
  postMoneyVarianceResolution,
  getMoneyVarianceResolutionsForReport,
} from '../controllers/moneyVarianceResolution.controller.js';
import { requireAuth, requireRole, requireShopAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createDailySalesReportSchema,
  idParamSchema,
  listDailySalesReportsQuerySchema,
  dailySummaryQuerySchema,
} from '../validators/dailySalesReport.validators.js';
import { createCorrectionRequestSchema } from '../validators/dailyReportCorrection.validators.js';
import { createStockVarianceResolutionSchema } from '../validators/stockVarianceResolution.validators.js';
import { createMoneyVarianceResolutionSchema } from '../validators/moneyVarianceResolution.validators.js';
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

// Shop access for all of the following is checked inside each controller
// (fetch the report, then canAccessShop against its shopId) since the shop
// isn't directly in params/body here — only the report id is.

router.get('/:id/effective', requireAuth, validate(idParamSchema, 'params'), getEffectiveReport);

router.post(
  '/:id/corrections',
  requireAuth,
  // ADMIN excluded — same conservative stance as everywhere else in Phase
  // 2/3/4: no new write capability without an explicit permission
  // architecture granting it.
  requireRole(ROLES.OWNER, ROLES.MANAGER, ROLES.SALESPERSON),
  validate(idParamSchema, 'params'),
  validate(createCorrectionRequestSchema),
  postCorrectionRequest
);

router.get('/:id/corrections', requireAuth, validate(idParamSchema, 'params'), getCorrectionsForReport);

router.post(
  '/:id/stock-variance-resolutions',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(createStockVarianceResolutionSchema),
  postStockVarianceResolution
);

router.get(
  '/:id/stock-variance-resolutions',
  requireAuth,
  validate(idParamSchema, 'params'),
  getStockVarianceResolutionsForReport
);

router.post(
  '/:id/money-variance-resolutions',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(createMoneyVarianceResolutionSchema),
  postMoneyVarianceResolution
);

router.get(
  '/:id/money-variance-resolutions',
  requireAuth,
  validate(idParamSchema, 'params'),
  getMoneyVarianceResolutionsForReport
);

export default router;
