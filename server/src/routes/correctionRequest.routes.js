import { Router } from 'express';
import {
  getPendingCorrectionRequests,
  postApproveCorrectionRequest,
  postRejectCorrectionRequest,
} from '../controllers/dailyReportCorrection.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  rejectCorrectionRequestSchema,
} from '../validators/dailyReportCorrection.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Must be registered before POST '/:id/approve' etc. is irrelevant here
// (different literal suffixes), but kept first for readability.
router.get('/pending', requireAuth, requireRole(ROLES.OWNER), getPendingCorrectionRequests);

router.post(
  '/:id/approve',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  postApproveCorrectionRequest
);

router.post(
  '/:id/reject',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(idParamSchema, 'params'),
  validate(rejectCorrectionRequestSchema),
  postRejectCorrectionRequest
);

export default router;
