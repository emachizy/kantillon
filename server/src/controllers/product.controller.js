import {
  createProduct,
  listProducts as listProductsService,
  getProductDetail,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
} from '../services/productService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';
import { ROLES } from '../utils/constants.js';

// Products are not shop-scoped, so every authenticated user can list them
// regardless of shop assignment — only OWNER may additionally request
// inactive ones; the flag is silently ignored for every other role rather
// than trusting the query string.
export const listProducts = catchAsync(async (req, res) => {
  const includeInactive = req.user.role === ROLES.OWNER && req.query.includeInactive;
  const products = await listProductsService({ includeInactive });
  sendSuccess(res, { data: { products } });
});

export const postCreateProduct = catchAsync(async (req, res) => {
  const { name, unit } = req.body;
  const product = await createProduct({ name, unit, actingUser: req.user, req });
  sendSuccess(res, { statusCode: 201, data: { product } });
});

export const getProductByIdHandler = catchAsync(async (req, res) => {
  const product = await getProductDetail(req.params.productId);
  sendSuccess(res, { data: { product } });
});

export const patchProductHandler = catchAsync(async (req, res) => {
  const product = await updateProduct({ id: req.params.productId, updates: req.body, actingUser: req.user, req });
  sendSuccess(res, { data: { product } });
});

export const postDeactivateProduct = catchAsync(async (req, res) => {
  const product = await deactivateProduct({ id: req.params.productId, actingUser: req.user, req });
  sendSuccess(res, { data: { product } });
});

export const postReactivateProduct = catchAsync(async (req, res) => {
  const product = await reactivateProduct({ id: req.params.productId, actingUser: req.user, req });
  sendSuccess(res, { data: { product } });
});
