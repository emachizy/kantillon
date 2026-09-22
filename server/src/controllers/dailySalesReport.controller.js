import {
  submitDailySalesReport,
  listDailySalesReports,
  getDailySalesReportById,
} from '../services/dailySalesReportService.js';
import { getAccessibleShopIds, canAccessShop } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postDailySalesReport = catchAsync(async (req, res) => {
  const {
    shopId,
    productId,
    businessDate,
    salesLines,
    physicalClosingStockQuantity,
    actualAmountCollectedKobo,
    notes,
  } = req.body;

  const { report, transaction } = await submitDailySalesReport({
    shopId,
    productId,
    businessDate,
    salesLines,
    physicalClosingStockQuantity,
    actualAmountCollectedKobo,
    notes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, { statusCode: 201, data: { report, transaction } });
});

// Shared shop-scoping logic between history and summary listing: OWNER
// sees everything (optionally filtered), everyone else only their assigned
// shops — same pattern as stockReceipt.controller.js's history endpoint.
function buildShopScopedFilter(user, { shopId, productId, businessDate }) {
  const filter = {};
  if (productId) filter.productId = productId;
  if (businessDate) filter.businessDate = businessDate;

  const accessible = getAccessibleShopIds(user);

  if (shopId) {
    if (accessible !== 'ALL' && !accessible.includes(shopId)) {
      throw ApiError.forbidden('You do not have access to this shop');
    }
    filter.shopId = shopId;
  } else if (accessible !== 'ALL') {
    filter.shopId = { $in: accessible };
  }

  return filter;
}

export const getDailySalesReports = catchAsync(async (req, res) => {
  const filter = buildShopScopedFilter(req.user, req.query);
  const reports = await listDailySalesReports(filter);
  sendSuccess(res, { data: { reports } });
});

export const getDailySalesReportByIdHandler = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }
  sendSuccess(res, { data: { report } });
});

// OWNER-only cross-shop view for one business date.
export const getDailySummary = catchAsync(async (req, res) => {
  const { businessDate } = req.query;
  const reports = await listDailySalesReports({ businessDate });
  sendSuccess(res, { data: { businessDate, reports } });
});
