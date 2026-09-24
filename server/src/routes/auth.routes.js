import { Router } from 'express';
import { login, logout, me, changePassword } from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, changePasswordSchema } from '../validators/auth.validators.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/login', authRateLimiter, validate(loginSchema), login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, validate(changePasswordSchema), changePassword);

export default router;
