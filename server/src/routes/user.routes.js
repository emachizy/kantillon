import { Router } from 'express';
import {
  postCreateUser,
  getUsersHandler,
  getUserByIdHandler,
  patchUserHandler,
  postDeactivateUser,
  postReactivateUser,
  postResetPasswordHandler,
} from '../controllers/user.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createStaffUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  listUsersQuerySchema,
  idParamSchema,
} from '../validators/userManagement.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Every route here is OWNER-only — staff management is not delegated to
// any other role in this MVP (see README "Role restrictions").
router.use(requireAuth, requireRole(ROLES.OWNER));

router.get('/', validate(listUsersQuerySchema, 'query'), getUsersHandler);
router.post('/', validate(createStaffUserSchema), postCreateUser);
router.get('/:id', validate(idParamSchema, 'params'), getUserByIdHandler);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateUserSchema), patchUserHandler);
router.post('/:id/deactivate', validate(idParamSchema, 'params'), postDeactivateUser);
router.post('/:id/reactivate', validate(idParamSchema, 'params'), postReactivateUser);
router.post(
  '/:id/reset-password',
  validate(idParamSchema, 'params'),
  validate(resetPasswordSchema),
  postResetPasswordHandler
);

export default router;
