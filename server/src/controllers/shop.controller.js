import { Shop } from '../models/Shop.js';
import { getAccessibleShopIds } from '../services/shopAccessService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const listShops = catchAsync(async (req, res) => {
  const accessible = getAccessibleShopIds(req.user);
  const filter = accessible === 'ALL' ? {} : { _id: { $in: accessible } };

  const shops = await Shop.find(filter).sort({ name: 1 });
  sendSuccess(res, { data: { shops } });
});
