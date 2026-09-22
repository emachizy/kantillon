import { Router } from 'express';
import { listProducts } from '../controllers/product.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, listProducts);

export default router;
