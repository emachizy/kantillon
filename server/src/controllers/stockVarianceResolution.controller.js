import {
  createStockVarianceResolution,
  reverseStockVarianceResolution,
  listStockVarianceResolutionsForReport,
} from '../services/stockVarianceResolutionService.js';
import { getDailySalesReportById } from '../services/dailySalesReportService.js';
import { canAccessShop } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postStockVarianceResolution = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const { resolutionType, quantity, reason, notes } = req.body;

  const { resolution, transaction, remainingStockVarianceQuantity } = await createStockVarianceResolution({
    reportId: report._id,
    resolutionType,
    quantity,
    reason,
    notes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, {
    statusCode: 201,
    data: { resolution, transaction, remainingStockVarianceQuantity },
  });
});

export const getStockVarianceResolutionsForReport = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const resolutions = await listStockVarianceResolutionsForReport(report._id);
  sendSuccess(res, { data: { resolutions } });
});

export const postReverseStockVarianceResolution = catchAsync(async (req, res) => {
  const { resolution, reversalTransaction } = await reverseStockVarianceResolution({
    id: req.params.id,
    reason: req.body.reason,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { resolution, reversalTransaction } });
});
