import {
  createMoneyVarianceResolution,
  reverseMoneyVarianceResolution,
  listMoneyVarianceResolutionsForReport,
} from '../services/moneyVarianceResolutionService.js';
import { getDailySalesReportById } from '../services/dailySalesReportService.js';
import { canAccessShop } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postMoneyVarianceResolution = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const { resolutionType, amountKobo, reason, notes } = req.body;

  const { resolution, remainingMoneyVarianceKobo } = await createMoneyVarianceResolution({
    reportId: report._id,
    resolutionType,
    amountKobo,
    reason,
    notes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, { statusCode: 201, data: { resolution, remainingMoneyVarianceKobo } });
});

export const getMoneyVarianceResolutionsForReport = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const resolutions = await listMoneyVarianceResolutionsForReport(report._id);
  sendSuccess(res, { data: { resolutions } });
});

export const postReverseMoneyVarianceResolution = catchAsync(async (req, res) => {
  const resolution = await reverseMoneyVarianceResolution({
    id: req.params.id,
    reason: req.body.reason,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { resolution } });
});
