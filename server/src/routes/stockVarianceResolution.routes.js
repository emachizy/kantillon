import { Router } from 'express';
import { postReverseStockVarianceResolution } from '../controllers/stockVarianceResolution.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  reverseStockVarianceResolutionSchema,
} from '../validators/stockVarianceResolution.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.post(
  '/:id/reverse',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(reverseStockVarianceResolutionSchema),
  postReverseStockVarianceResolution
);

export default router;
