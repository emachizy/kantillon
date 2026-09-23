import { Router } from 'express';
import { postReverseMoneyVarianceResolution } from '../controllers/moneyVarianceResolution.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  reverseMoneyVarianceResolutionSchema,
} from '../validators/moneyVarianceResolution.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.post(
  '/:id/reverse',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(reverseMoneyVarianceResolutionSchema),
  postReverseMoneyVarianceResolution
);

export default router;
