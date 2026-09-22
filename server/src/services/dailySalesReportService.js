import { DailySalesReport } from '../models/DailySalesReport.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { StockReceipt } from '../models/StockReceipt.js';
import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import {
  getOpeningStockForBusinessDate,
  getApprovedStockReceivedForBusinessDate,
} from './inventoryService.js';
import { isFutureBusinessDate } from '../utils/businessDate.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';

const REPORT_POPULATE = [
  { path: 'shopId', select: 'name code' },
  { path: 'productId', select: 'name sku unit' },
  { path: 'submittedBy', select: 'name role' },
];

// The latest business date already closed by a submitted report for this
// shop/product, or null if none exists yet. Used both to reject
// out-of-chronological-order report submission and (by
// stockReceiptService) to reject a backdated receipt that would rewrite an
// already-closed period.
export async function getLatestClosedBusinessDate(shopId, productId) {
  const latest = await DailySalesReport.findOne({ shopId, productId })
    .sort({ businessDate: -1 })
    .select('businessDate');
  return latest?.businessDate ?? null;
}

export async function hasPendingReceiptForBusinessDate(shopId, productId, businessDate) {
  const exists = await StockReceipt.exists({ shopId, productId, businessDate, status: 'PENDING' });
  return Boolean(exists);
}

export async function submitDailySalesReport({
  shopId,
  productId,
  businessDate,
  salesLines,
  physicalClosingStockQuantity,
  actualAmountCollectedKobo,
  notes,
  actingUser,
  req,
}) {
  const [shop, product] = await Promise.all([Shop.findById(shopId), Product.findById(productId)]);

  if (!shop) throw ApiError.notFound('Shop not found');
  if (!shop.isActive) throw ApiError.badRequest('Shop is not active');
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isActive) throw ApiError.badRequest('Product is not active');

  if (isFutureBusinessDate(businessDate)) {
    throw ApiError.badRequest('businessDate cannot be in the future');
  }

  // Duplicate business day — the unique index on {shopId, productId,
  // businessDate} is the real, race-proof guard (see the E11000 handling
  // below); this is just a fast, friendly pre-check.
  const existingReport = await DailySalesReport.findOne({ shopId, productId, businessDate });
  if (existingReport) {
    throw ApiError.conflict(
      `A daily sales report already exists for this shop/product on ${businessDate}`
    );
  }

  // Chronological ledger integrity: cannot insert a report for a date
  // earlier than one already closed by a later report.
  const latestClosed = await getLatestClosedBusinessDate(shopId, productId);
  if (latestClosed && businessDate < latestClosed) {
    throw ApiError.conflict(
      `A later business date (${latestClosed}) has already been closed for this shop/product; ` +
        'reports must be submitted in chronological order'
    );
  }

  // A pending stock receipt for this exact day means expected closing stock
  // isn't authoritative yet — it could still be approved or rejected.
  if (await hasPendingReceiptForBusinessDate(shopId, productId, businessDate)) {
    throw ApiError.conflict(
      'A pending stock receipt exists for this shop/product/business date; ' +
        'it must be approved or rejected before the daily report can be submitted'
    );
  }

  // Server-computed values only — the client's salesLines are trusted only
  // for quantity/unitPriceKobo; every derived number below is calculated
  // here, never taken from the request body.
  const computedSalesLines = salesLines.map(({ quantity, unitPriceKobo }) => {
    const lineRevenueKobo = quantity * unitPriceKobo;
    if (!Number.isSafeInteger(lineRevenueKobo)) {
      throw ApiError.badRequest('A sales line revenue calculation exceeded safe integer range');
    }
    return { quantity, unitPriceKobo, lineRevenueKobo };
  });

  const totalQuantitySold = computedSalesLines.reduce((sum, l) => sum + l.quantity, 0);
  const expectedRevenueKobo = computedSalesLines.reduce((sum, l) => sum + l.lineRevenueKobo, 0);
  if (!Number.isSafeInteger(totalQuantitySold) || !Number.isSafeInteger(expectedRevenueKobo)) {
    throw ApiError.badRequest('Sales totals exceeded safe integer range');
  }

  const [openingStockQuantity, approvedStockReceivedQuantity] = await Promise.all([
    getOpeningStockForBusinessDate(shopId, productId, businessDate),
    getApprovedStockReceivedForBusinessDate(shopId, productId, businessDate),
  ]);

  const availableStockQuantity = openingStockQuantity + approvedStockReceivedQuantity;

  if (totalQuantitySold > availableStockQuantity) {
    throw ApiError.conflict(
      `Reported sales (${totalQuantitySold}) exceed approved available stock ` +
        `(${availableStockQuantity}) for this business date; resolve stock records/receipts first`
    );
  }

  const expectedClosingStockQuantity = availableStockQuantity - totalQuantitySold;
  const stockVarianceQuantity = physicalClosingStockQuantity - expectedClosingStockQuantity;
  const moneyVarianceKobo = actualAmountCollectedKobo - expectedRevenueKobo;

  const submittedAt = new Date();

  // Same multi-document create + compensation strategy as
  // stockReceiptService.submitStockReceipt (Phase 2) — see
  // utils/transactionRunner.js and README "Concurrency & consistency
  // strategy" for why this is safe without a replica set.
  const { report, transaction } = await runWithOptionalTransaction(async (session) => {
    let createdReport;
    let createdTransaction;
    try {
      [createdReport] = await DailySalesReport.create(
        [
          {
            shopId,
            productId,
            businessDate,
            salesLines: computedSalesLines,
            openingStockQuantity,
            approvedStockReceivedQuantity,
            availableStockQuantity,
            totalQuantitySold,
            expectedClosingStockQuantity,
            physicalClosingStockQuantity,
            stockVarianceQuantity,
            expectedRevenueKobo,
            actualAmountCollectedKobo,
            moneyVarianceKobo,
            submittedBy: actingUser._id,
            submittedAt,
            notes,
            status: 'SUBMITTED',
          },
        ],
        { session }
      );

      [createdTransaction] = await InventoryTransaction.create(
        [
          {
            shopId,
            productId,
            type: 'SALE',
            direction: 'OUT',
            quantity: totalQuantitySold,
            referenceType: 'DAILY_SALES_REPORT',
            referenceId: createdReport._id,
            status: 'APPROVED',
            createdBy: actingUser._id,
            approvedBy: null,
            businessDate,
          },
        ],
        { session }
      );

      createdReport.saleInventoryTransactionId = createdTransaction._id;
      await createdReport.save({ session });

      return { report: createdReport, transaction: createdTransaction };
    } catch (err) {
      if (session) {
        throw err;
      }

      const cleanupTasks = [];
      if (createdReport) cleanupTasks.push(DailySalesReport.deleteOne({ _id: createdReport._id }));
      if (createdTransaction) {
        cleanupTasks.push(InventoryTransaction.deleteOne({ _id: createdTransaction._id }));
      }
      const cleanupResults = cleanupTasks.length ? await Promise.allSettled(cleanupTasks) : [];
      const cleanupFailures = cleanupResults.filter((r) => r.status === 'rejected');

      // eslint-disable-next-line no-console
      console.error('[DAILY_SALES_REPORT_PARTIAL_FAILURE]', {
        shopId,
        productId,
        businessDate,
        createdReportId: createdReport?._id,
        createdTransactionId: createdTransaction?._id,
        originalError: err,
        cleanupAttempted: cleanupTasks.length,
        cleanupFailures: cleanupFailures.length,
      });

      if (err.code === 11000) {
        // Another request won the race on the {shopId, productId,
        // businessDate} unique index between our pre-check and this insert.
        throw ApiError.conflict(
          `A daily sales report already exists for this shop/product on ${businessDate}`
        );
      }

      if (cleanupFailures.length) {
        throw ApiError.internal(
          'Failed to submit daily sales report, and cleanup of partially-created data also ' +
            'failed. This requires manual review — see server logs for DAILY_SALES_REPORT_PARTIAL_FAILURE.'
        );
      }

      throw ApiError.internal(
        'Failed to submit daily sales report consistently; no partial record was retained. Please try again.'
      );
    }
  });

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId,
    action: AUDIT_ACTIONS.DAILY_SALES_REPORT_SUBMITTED,
    entityType: 'DailySalesReport',
    entityId: report._id,
    newValue: {
      businessDate,
      totalQuantitySold,
      expectedClosingStockQuantity,
      physicalClosingStockQuantity,
      stockVarianceQuantity,
      expectedRevenueKobo,
      actualAmountCollectedKobo,
      moneyVarianceKobo,
    },
  });

  await report.populate(REPORT_POPULATE);
  return { report, transaction };
}

export async function listDailySalesReports(filter) {
  return DailySalesReport.find(filter).sort({ businessDate: -1, createdAt: -1 }).populate(REPORT_POPULATE);
}

export async function getDailySalesReportById(id) {
  const report = await DailySalesReport.findById(id).populate(REPORT_POPULATE);
  if (!report) throw ApiError.notFound('Daily sales report not found');
  return report;
}
