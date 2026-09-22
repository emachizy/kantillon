import {
  submitStockReceipt,
  approveStockReceipt,
  rejectStockReceipt,
  listPendingStockReceipts,
  listStockReceipts,
} from '../services/stockReceiptService.js';
import { getAccessibleShopIds } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postStockReceipt = catchAsync(async (req, res) => {
  const { shopId, productId, quantity, deliveryReference, notes } = req.body;

  const { receipt, transaction } = await submitStockReceipt({
    shopId,
    productId,
    quantity,
    deliveryReference,
    notes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, { statusCode: 201, data: { receipt, transaction } });
});

export const getPendingStockReceipts = catchAsync(async (_req, res) => {
  const receipts = await listPendingStockReceipts();
  sendSuccess(res, { data: { receipts } });
});

export const postApproveStockReceipt = catchAsync(async (req, res) => {
  const { receipt, balance } = await approveStockReceipt({
    id: req.params.id,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { receipt, balance } });
});

export const postRejectStockReceipt = catchAsync(async (req, res) => {
  const { receipt } = await rejectStockReceipt({
    id: req.params.id,
    reason: req.body.reason,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { receipt } });
});

export const getStockReceiptHistory = catchAsync(async (req, res) => {
  const { shopId, status, productId } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (productId) filter.productId = productId;

  const accessible = getAccessibleShopIds(req.user);

  if (shopId) {
    if (accessible !== 'ALL' && !accessible.includes(shopId)) {
      throw ApiError.forbidden('You do not have access to this shop');
    }
    filter.shopId = shopId;
  } else if (accessible !== 'ALL') {
    // No shop specified and not an owner: scope to every shop this user can
    // see (an empty list means the filter matches nothing, correctly).
    filter.shopId = { $in: accessible };
  }

  const receipts = await listStockReceipts(filter);
  sendSuccess(res, { data: { receipts } });
});
