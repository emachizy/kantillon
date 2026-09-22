import { Shop } from '../models/Shop.js';
import { createOpeningStock } from '../services/openingStockService.js';
import { getShopInventory } from '../services/inventoryService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postOpeningStock = catchAsync(async (req, res) => {
  const { shopId, productId, quantity, notes } = req.body;

  const { transaction, balance } = await createOpeningStock({
    shopId,
    productId,
    quantity,
    notes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, { statusCode: 201, data: { transaction, balance } });
});

export const getShopInventoryHandler = catchAsync(async (req, res) => {
  const { shopId } = req.params;

  const shop = await Shop.findById(shopId);
  if (!shop) throw ApiError.notFound('Shop not found');

  const inventory = await getShopInventory(shopId);

  sendSuccess(res, {
    data: {
      shop: { id: shop._id, name: shop.name },
      inventory,
    },
  });
});
