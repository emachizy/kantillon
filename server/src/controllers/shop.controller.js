import {
  createShop,
  listShops as listShopsService,
  getShopDetail,
  updateShop,
  deactivateShop,
  reactivateShop,
} from '../services/shopService.js';
import { listShopStaff } from '../services/userManagementService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const listShops = catchAsync(async (req, res) => {
  const shops = await listShopsService(req.user, { includeInactive: req.query.includeInactive });
  sendSuccess(res, { data: { shops } });
});

export const postCreateShop = catchAsync(async (req, res) => {
  const { name, address, phone, notes } = req.body;
  const shop = await createShop({ name, address, phone, notes, actingUser: req.user, req });
  sendSuccess(res, { statusCode: 201, data: { shop } });
});

export const getShopByIdHandler = catchAsync(async (req, res) => {
  const shop = await getShopDetail(req.params.shopId, req.user);
  sendSuccess(res, { data: { shop } });
});

export const patchShopHandler = catchAsync(async (req, res) => {
  const shop = await updateShop({ id: req.params.shopId, updates: req.body, actingUser: req.user, req });
  sendSuccess(res, { data: { shop } });
});

export const postDeactivateShop = catchAsync(async (req, res) => {
  const shop = await deactivateShop({ id: req.params.shopId, actingUser: req.user, req });
  sendSuccess(res, { data: { shop } });
});

export const postReactivateShop = catchAsync(async (req, res) => {
  const shop = await reactivateShop({ id: req.params.shopId, actingUser: req.user, req });
  sendSuccess(res, { data: { shop } });
});

// OWNER-only (see routes/shop.routes.js) — staff management is not
// delegated to any other role in this MVP, so this reuses the same
// service function POST /api/users relies on rather than a second
// assignment system.
export const getShopStaffHandler = catchAsync(async (req, res) => {
  const staff = await listShopStaff(req.params.shopId);
  sendSuccess(res, { data: { staff } });
});
