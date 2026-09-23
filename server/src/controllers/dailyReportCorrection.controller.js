import {
  requestCorrection,
  listCorrectionRequestsForReport,
  listPendingCorrectionRequests,
  approveCorrectionRequest,
  rejectCorrectionRequest,
  getEffectiveDailyReport,
} from '../services/dailyReportCorrectionService.js';
import { getDailySalesReportById } from '../services/dailySalesReportService.js';
import { canAccessShop } from '../services/shopAccessService.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postCorrectionRequest = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const {
    reason,
    proposedSalesLines,
    proposedPhysicalClosingStockQuantity,
    proposedActualAmountCollectedKobo,
    proposedNotes,
  } = req.body;

  const request = await requestCorrection({
    reportId: report._id,
    reason,
    proposedSalesLines,
    proposedPhysicalClosingStockQuantity,
    proposedActualAmountCollectedKobo,
    proposedNotes,
    actingUser: req.user,
    req,
  });

  sendSuccess(res, { statusCode: 201, data: { request } });
});

export const getCorrectionsForReport = catchAsync(async (req, res) => {
  const report = await getDailySalesReportById(req.params.id);
  if (!canAccessShop(req.user, report.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }

  const requests = await listCorrectionRequestsForReport(report._id);
  sendSuccess(res, { data: { requests } });
});

export const getPendingCorrectionRequests = catchAsync(async (_req, res) => {
  const requests = await listPendingCorrectionRequests();
  sendSuccess(res, { data: { requests } });
});

export const postApproveCorrectionRequest = catchAsync(async (req, res) => {
  const { correction, request } = await approveCorrectionRequest({
    id: req.params.id,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { correction, request } });
});

export const postRejectCorrectionRequest = catchAsync(async (req, res) => {
  const request = await rejectCorrectionRequest({
    id: req.params.id,
    reason: req.body.reason,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { request } });
});

export const getEffectiveReport = catchAsync(async (req, res) => {
  const effective = await getEffectiveDailyReport(req.params.id);
  if (!canAccessShop(req.user, effective.original.shopId._id)) {
    throw ApiError.forbidden('You do not have access to this shop');
  }
  sendSuccess(res, { data: effective });
});
