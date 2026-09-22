import { getCurrentShopPrice } from '../services/shopPriceService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const getCurrentShopPriceHandler = catchAsync(async (req, res) => {
  const { shopId, productId } = req.params;
  const price = await getCurrentShopPrice(shopId, productId);
  sendSuccess(res, { data: { price } });
});
