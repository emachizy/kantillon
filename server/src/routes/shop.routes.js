import { Router } from 'express';
import { listShops } from '../controllers/shop.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listShops);

export default router;
