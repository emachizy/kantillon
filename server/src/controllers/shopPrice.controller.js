import {
  getCurrentShopPrice,
  setShopPrice,
  getCurrentPricesForProduct,
  getCurrentPricesForShop,
} from '../services/shopPriceService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const getCurrentShopPriceHandler = catchAsync(async (req, res) => {
  const { shopId, productId } = req.params;
  const price = await getCurrentShopPrice(shopId, productId);
  sendSuccess(res, { data: { price } });
});

export const postSetShopPriceHandler = catchAsync(async (req, res) => {
  const { shopId, productId, priceKobo } = req.body;
  const price = await setShopPrice({ shopId, productId, priceKobo, actingUser: req.user, req });
  sendSuccess(res, { statusCode: 201, data: { price } });
});

export const getCurrentPricesForProductHandler = catchAsync(async (req, res) => {
  const prices = await getCurrentPricesForProduct(req.params.productId);
  sendSuccess(res, { data: { prices } });
});

export const getCurrentPricesForShopHandler = catchAsync(async (req, res) => {
  const prices = await getCurrentPricesForShop(req.params.shopId);
  sendSuccess(res, { data: { prices } });
});
