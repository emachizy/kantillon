import { Router } from 'express';
import {
  listProducts,
  postCreateProduct,
  getProductByIdHandler,
  patchProductHandler,
  postDeactivateProduct,
  postReactivateProduct,
} from '../controllers/product.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
} from '../validators/product.validators.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.get('/', requireAuth, validate(listProductsQuerySchema, 'query'), listProducts);
router.post('/', requireAuth, requireRole(ROLES.OWNER), validate(createProductSchema), postCreateProduct);

router.get('/:productId', requireAuth, validate(productIdParamSchema, 'params'), getProductByIdHandler);
router.patch(
  '/:productId',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(productIdParamSchema, 'params'),
  validate(updateProductSchema),
  patchProductHandler
);

router.post(
  '/:productId/deactivate',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(productIdParamSchema, 'params'),
  postDeactivateProduct
);
router.post(
  '/:productId/reactivate',
  requireAuth,
  requireRole(ROLES.OWNER),
  validate(productIdParamSchema, 'params'),
  postReactivateProduct
);

export default router;
