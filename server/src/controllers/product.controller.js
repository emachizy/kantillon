import { Product } from '../models/Product.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

// Products are not shop-scoped, so every authenticated user can list them
// regardless of shop assignment.
export const listProducts = catchAsync(async (_req, res) => {
  const products = await Product.find().sort({ name: 1 });
  sendSuccess(res, { data: { products } });
});
