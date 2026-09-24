import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, loginAgent } from './factories.js';
import {
  setupShopWithUsers,
  createOpeningStockDirect,
  cleanReportPayload,
  variantReportPayload,
} from './dailyReportFixtures.js';
import { ROLES } from '../src/utils/constants.js';
import { DailySalesReport } from '../src/models/DailySalesReport.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { DailySalesCorrection } from '../src/models/DailySalesCorrection.js';
import { DailyReportCorrectionRequest } from '../src/models/DailyReportCorrectionRequest.js';
import { DailyReportResolutionState } from '../src/models/DailyReportResolutionState.js';
import { getInventoryBalance } from '../src/services/inventoryService.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function submitCleanReport(salesAgent, shop, product, owner, overrides = {}) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(cleanReportPayload(shop, product, overrides));
}

function correctionPayload(overrides = {}) {
  return {
    reason: 'Salesperson miscounted bags sold',
    proposedSalesLines: [{ quantity: 390, unitPriceKobo: 1200000 }],
    proposedPhysicalClosingStockQuantity: 1110,
    proposedActualAmountCollectedKobo: 468000000,
    proposedNotes: 'Recount confirmed 390',
    ...overrides,
  };
}

describe('POST /api/daily-reports/:id/corrections — request', () => {
  it('lets an assigned salesperson request a correction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(201);
    expect(res.body.data.request.status).toBe('PENDING');
  });

  it('lets a manager request a correction for their assigned shop', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const manager = await loginAgent(app, 'manager@test.dev');
    const res = await manager.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(201);
  });

  it('rejects a salesperson requesting a correction for an unauthorized shop', async () => {
    const { shopB, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopB, product, owner, 1500, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const submitRes = await ownerAgent.post('/api/daily-reports').send(cleanReportPayload(shopB, product));
    const reportId = submitRes.body.data.report._id;

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(403);
  });

  it('rejects an ADMIN requesting a correction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shopA._id] });
    const admin = await loginAgent(app, 'admin@test.dev');
    const res = await admin.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(403);
  });

  it('allows only one pending correction at a time', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const first = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(first.status).toBe(201);

    const second = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(second.status).toBe(409);
  });

  it('requires a correction reason', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales
      .post(`/api/daily-reports/${reportId}/corrections`)
      .send(correctionPayload({ reason: '' }));
    expect(res.status).toBe(400);
  });

  it('validates proposed values the same way report submission does', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const fractional = await sales
      .post(`/api/daily-reports/${reportId}/corrections`)
      .send(correctionPayload({ proposedSalesLines: [{ quantity: 390.5, unitPriceKobo: 1200000 }] }));
    expect(fractional.status).toBe(400);

    const exceedsStock = await sales
      .post(`/api/daily-reports/${reportId}/corrections`)
      .send(correctionPayload({ proposedSalesLines: [{ quantity: 999999, unitPriceKobo: 1200000 }] }));
    expect(exceedsStock.status).toBe(409);
  });

  it('cannot have calculated fields spoofed', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        expectedRevenueKobo: 1,
        stockVarianceQuantity: 999,
        status: 'APPROVED',
      })
    );
    expect(res.status).toBe(201);
    // No such fields exist on the request model at all — they were stripped.
    expect(res.body.data.request.expectedRevenueKobo).toBeUndefined();
    expect(res.body.data.request.status).toBe('PENDING');
  });
});

describe('POST /api/correction-requests/:id/approve and /reject', () => {
  it('lets OWNER approve a pending correction request', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.correction.totalQuantitySold).toBe(390);
    // The API must return the FINAL APPROVED request, never the stale
    // PROCESSING one captured at claim time.
    expect(res.body.data.request.status).toBe('APPROVED');
    expect(res.body.data.request.approvedCorrectionId).toBe(res.body.data.correction._id);
  });

  it('rejects a non-owner attempting to approve', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const res = await sales.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(res.status).toBe(403);
  });

  it('lets OWNER reject with a reason', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent
      .post(`/api/correction-requests/${reqRes.body.data.request._id}/reject`)
      .send({ reason: 'Not credible' });
    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('REJECTED');
  });

  it('requires a reason to reject', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/reject`).send({});
    expect(res.status).toBe(400);
  });

  it('cannot approve an already-approved request', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const requestId = reqRes.body.data.request._id;
    await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    const second = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(second.status).toBe(409);
  });

  it('cannot approve an already-rejected request', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const requestId = reqRes.body.data.request._id;
    await ownerAgent.post(`/api/correction-requests/${requestId}/reject`).send({ reason: 'no' });
    const res = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(res.status).toBe(409);
  });

  it('under real concurrency, exactly one of two simultaneous approvals wins', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const [first, second] = await Promise.all([
      ownerAgent.post(`/api/correction-requests/${requestId}/approve`),
      ownerAgent.post(`/api/correction-requests/${requestId}/approve`),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const correctionCount = await DailySalesCorrection.countDocuments({ dailySalesReportId: reportId });
    expect(correctionCount).toBe(1);
  });
});

describe('Corrected calculations', () => {
  it('recalculates expected closing stock from corrected quantity', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);

    // available 1500, corrected sold 390 => expected closing 1110
    expect(res.body.data.correction.expectedClosingStockQuantity).toBe(1110);
    expect(res.body.data.correction.stockVarianceQuantity).toBe(0); // proposed physical 1110
  });

  it('recalculates revenue from corrected prices', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1250000 }],
        proposedPhysicalClosingStockQuantity: 1100,
        proposedActualAmountCollectedKobo: 500000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(res.body.data.correction.expectedRevenueKobo).toBe(500000000);
  });

  it('recalculates money variance from corrected collection amount', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1100,
        proposedActualAmountCollectedKobo: 470000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(res.body.data.correction.moneyVarianceKobo).toBe(-10000000);
  });

  it('recalculates stock variance from corrected physical count', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1105,
        proposedActualAmountCollectedKobo: 480000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    // expected closing still 1100 (400 sold unchanged), physical 1105 => +5
    expect(res.body.data.correction.stockVarianceQuantity).toBe(5);
  });

  it('keeps historical opening/received quantities unchanged by the correction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);

    expect(res.body.data.correction.openingStockQuantity).toBe(1500);
    expect(res.body.data.correction.approvedStockReceivedQuantity).toBe(0);
    expect(res.body.data.correction.availableStockQuantity).toBe(1500);
  });

  it('rejects a correction whose quantity exceeds historical available stock', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({ proposedSalesLines: [{ quantity: 2000, unitPriceKobo: 1200000 }] })
    );
    expect(res.status).toBe(409);
  });
});

describe('Ledger correction behavior', () => {
  it('a quantity change creates a REVERSAL opposing the effective SALE, then a replacement SALE with the corrected quantity', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const originalSaleId = submitRes.body.data.transaction._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveRes = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    const { correction } = approveRes.body.data;

    expect(correction.reversalInventoryTransactionId).toBeTruthy();
    expect(correction.replacementSaleInventoryTransactionId).toBeTruthy();

    const reversal = await InventoryTransaction.findById(correction.reversalInventoryTransactionId);
    expect(reversal.type).toBe('REVERSAL');
    expect(reversal.direction).toBe('IN');
    expect(reversal.quantity).toBe(400); // opposes the original effective sale of 400
    expect(reversal.referenceId.toString()).toBe(originalSaleId);

    const replacement = await InventoryTransaction.findById(correction.replacementSaleInventoryTransactionId);
    expect(replacement.type).toBe('SALE');
    expect(replacement.direction).toBe('OUT');
    expect(replacement.quantity).toBe(390);
    expect(replacement.referenceId.toString()).toBe(correction._id);

    // Official inventory: -400 (original) +400 (reversal) -390 (replacement) = -390 net
    const balance = await getInventoryBalance(shopA._id, product._id);
    expect(balance).toBe(1500 - 390);

    // The original SALE and the original report remain fully queryable.
    const originalSale = await InventoryTransaction.findById(originalSaleId);
    expect(originalSale).not.toBeNull();
    expect(originalSale.status).toBe('APPROVED');
    const reportCheck = await ownerAgent.get(`/api/daily-reports/${reportId}`);
    expect(reportCheck.body.data.report.totalQuantitySold).toBe(400);
  });

  it('a same-quantity, price-only correction creates no inventory movement', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const originalSaleId = submitRes.body.data.transaction._id;

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1250000 }],
        proposedPhysicalClosingStockQuantity: 1100,
        proposedActualAmountCollectedKobo: 500000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveRes = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    const { correction } = approveRes.body.data;

    expect(correction.reversalInventoryTransactionId).toBeNull();
    expect(correction.replacementSaleInventoryTransactionId).toBeNull();
    expect(correction.effectiveSaleInventoryTransactionId).toBe(originalSaleId);

    const balance = await getInventoryBalance(shopA._id, product._id);
    expect(balance).toBe(1500 - 400); // unchanged

    const saleCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id, type: 'SALE' });
    expect(saleCount).toBe(1);
  });

  it('a physical-count-only correction creates no inventory movement', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1090,
        proposedActualAmountCollectedKobo: 480000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveRes = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(approveRes.body.data.correction.reversalInventoryTransactionId).toBeNull();

    const saleCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id, type: 'SALE' });
    expect(saleCount).toBe(1);
  });

  it('a money-only correction creates no inventory movement', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 400, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1100,
        proposedActualAmountCollectedKobo: 475000000,
      })
    );

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveRes = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(approveRes.body.data.correction.reversalInventoryTransactionId).toBeNull();
    expect(approveRes.body.data.correction.moneyVarianceKobo).toBe(-5000000);

    const saleCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id, type: 'SALE' });
    expect(saleCount).toBe(1);
  });
});

describe('Correction of a correction', () => {
  it('a second quantity correction reverses the current effective SALE (390), not the original (400)', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const req1 = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const approve1 = await ownerAgent.post(`/api/correction-requests/${req1.body.data.request._id}/approve`);
    const correction1 = approve1.body.data.correction;
    expect(correction1.totalQuantitySold).toBe(390);

    const req2 = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 395, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1105,
        proposedActualAmountCollectedKobo: 474000000,
      })
    );
    const approve2 = await ownerAgent.post(`/api/correction-requests/${req2.body.data.request._id}/approve`);
    const correction2 = approve2.body.data.correction;

    expect(correction2.correctionNumber).toBe(2);
    expect(correction2.supersedesCorrectionId).toBe(correction1._id);

    const reversal2 = await InventoryTransaction.findById(correction2.reversalInventoryTransactionId);
    expect(reversal2.quantity).toBe(390); // reverses correction #1's effective sale, not the original 400
    expect(reversal2.referenceId.toString()).toBe(correction1.effectiveSaleInventoryTransactionId);

    // Net ledger effect: -400 +400 -390 +390 -395 = -395
    const balance = await getInventoryBalance(shopA._id, product._id);
    expect(balance).toBe(1500 - 395);
  });

  it('correction history remains complete and queryable', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const req1 = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    await ownerAgent.post(`/api/correction-requests/${req1.body.data.request._id}/approve`);

    const req2 = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(
      correctionPayload({
        proposedSalesLines: [{ quantity: 395, unitPriceKobo: 1200000 }],
        proposedPhysicalClosingStockQuantity: 1105,
        proposedActualAmountCollectedKobo: 474000000,
      })
    );
    await ownerAgent.post(`/api/correction-requests/${req2.body.data.request._id}/approve`);

    const historyRes = await sales.get(`/api/daily-reports/${reportId}/corrections`);
    expect(historyRes.body.data.requests).toHaveLength(2);
    expect(historyRes.body.data.requests.every((r) => r.status === 'APPROVED')).toBe(true);
  });
});

describe('GET /api/daily-reports/:id/effective', () => {
  it('reports the original as effective when no correction exists', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.get(`/api/daily-reports/${reportId}/effective`);
    expect(res.status).toBe(200);
    expect(res.body.data.isCorrected).toBe(false);
    expect(res.body.data.effective.totalQuantitySold).toBe(400);
  });

  it('reports the latest approved correction as effective', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);

    const res = await sales.get(`/api/daily-reports/${reportId}/effective`);
    expect(res.body.data.isCorrected).toBe(true);
    expect(res.body.data.effective.totalQuantitySold).toBe(390);
  });

  it('a rejected correction never becomes effective', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/reject`).send({ reason: 'no' });

    const res = await sales.get(`/api/daily-reports/${reportId}/effective`);
    expect(res.body.data.isCorrected).toBe(false);
    expect(res.body.data.effective.totalQuantitySold).toBe(400);
  });

  it('the owner summary uses effective (corrected) numbers', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);

    // The summary/history endpoint itself still reports the ORIGINAL
    // report's stored totalQuantitySold (immutable) — effective values are
    // obtained via the dedicated /effective endpoint, which the owner UI
    // uses for display. Confirm both are independently correct.
    const summaryRes = await ownerAgent.get('/api/daily-reports/summary?businessDate=2020-01-10');
    expect(summaryRes.body.data.reports[0].totalQuantitySold).toBe(400);

    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.effective.totalQuantitySold).toBe(390);
  });
});

describe('Correction blocking by active variance resolutions', () => {
  it('blocks a new correction request once an active stock variance resolution exists', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(
      cleanReportPayload(shopA, product, { physicalClosingStockQuantity: 1097 })
    );
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 3,
      reason: 'confirmed shortage',
    });

    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(409);
  });

  it('blocks a new correction request once an active money variance resolution exists', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(
      cleanReportPayload(shopA, product, { actualAmountCollectedKobo: 470000000 })
    );
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'ACCEPTED_SHORTAGE',
      amountKobo: 10000000,
      reason: 'accepted',
    });

    const res = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(res.status).toBe(409);
  });
});

describe('Correction compensation (standalone MongoDB)', () => {
  it('a forced replacement-SALE failure leaves no half-applied correction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const originalCreate = InventoryTransaction.create.bind(InventoryTransaction);
    let callCount = 0;
    const spy = vi.spyOn(InventoryTransaction, 'create').mockImplementation(async (...args) => {
      callCount += 1;
      if (callCount === 2) {
        // First call creates the REVERSAL successfully; fail the second
        // (the replacement SALE).
        throw new Error('simulated failure creating the replacement SALE');
      }
      return originalCreate(...args);
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    try {
      const res = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
      expect(res.status).toBe(500);

      const correctionCount = await DailySalesCorrection.countDocuments({ dailySalesReportId: reportId });
      expect(correctionCount).toBe(0);

      const reversalOrphans = await InventoryTransaction.countDocuments({
        shopId: shopA._id,
        productId: product._id,
        type: 'REVERSAL',
      });
      expect(reversalOrphans).toBe(0);

      // The request was reverted back to PENDING, not left falsely APPROVED.
      const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
      expect(requestDoc.status).toBe('PENDING');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Correction audit logging', () => {
  it('audits request, approval, and rejection', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const submit1 = await submitCleanReport(sales, shopA, product, owner);
    const req1 = await sales.post(`/api/daily-reports/${submit1.body.data.report._id}/corrections`).send(correctionPayload());
    const requestedEntry = await AuditLog.findOne({ action: 'DAILY_REPORT_CORRECTION_REQUESTED' });
    expect(requestedEntry).not.toBeNull();

    await ownerAgent.post(`/api/correction-requests/${req1.body.data.request._id}/approve`);
    const approvedEntry = await AuditLog.findOne({ action: 'DAILY_REPORT_CORRECTION_APPROVED' });
    expect(approvedEntry).not.toBeNull();

    // No new opening stock needed — plenty of the original 1500 remains
    // available for the next business date (opening stock can only ever be
    // initialized once per shop/product, by design).
    const submit2 = await sales.post('/api/daily-reports').send(cleanReportPayload(shopA, product, { businessDate: '2020-01-11' }));
    const req2 = await sales.post(`/api/daily-reports/${submit2.body.data.report._id}/corrections`).send(correctionPayload());
    await ownerAgent.post(`/api/correction-requests/${req2.body.data.request._id}/reject`).send({ reason: 'no' });
    const rejectedEntry = await AuditLog.findOne({ action: 'DAILY_REPORT_CORRECTION_REJECTED' });
    expect(rejectedEntry).not.toBeNull();
  });
});

describe('Correction authorization / history visibility', () => {
  it('staff sees correction history only for their assigned shop', async () => {
    const { shopA, shopB, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const submitA = await submitCleanReport(sales, shopA, product, owner);
    await sales.post(`/api/daily-reports/${submitA.body.data.report._id}/corrections`).send(correctionPayload());

    await createOpeningStockDirect(shopB, product, owner, 1500, '2020-01-10');
    const submitB = await ownerAgent.post('/api/daily-reports').send(cleanReportPayload(shopB, product));
    const res = await sales.get(`/api/daily-reports/${submitB.body.data.report._id}/corrections`);
    expect(res.status).toBe(403);
  });

  it('the effective report endpoint is shop-scoped', async () => {
    const { shopB, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopB, product, owner, 1500, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const submitB = await ownerAgent.post('/api/daily-reports').send(cleanReportPayload(shopB, product));

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.get(`/api/daily-reports/${submitB.body.data.report._id}/effective`);
    expect(res.status).toBe(403);
  });
});

describe('Correction approval state machine (PROCESSING)', () => {
  it('a REJECTED request cannot become PROCESSING (cannot be approved)', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post(`/api/correction-requests/${requestId}/reject`).send({ reason: 'not credible' });

    const approveAttempt = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(approveAttempt.status).toBe(409);

    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('REJECTED');
  });

  it('a PROCESSING request cannot be rejected concurrently', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    // Simulate "mid-approval" directly, without racing real timing — the
    // reject endpoint's atomic filter only matches status PENDING, so a
    // PROCESSING request must be untouched by it regardless of how it got
    // there.
    await DailyReportCorrectionRequest.updateOne({ _id: requestId }, { status: 'PROCESSING' });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const rejectAttempt = await ownerAgent
      .post(`/api/correction-requests/${requestId}/reject`)
      .send({ reason: 'trying to reject mid-approval' });
    expect(rejectAttempt.status).toBe(409);

    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('PROCESSING');
  });

  it('a second approval attempt against an already-PROCESSING request is rejected with 409', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    await DailyReportCorrectionRequest.updateOne({ _id: requestId }, { status: 'PROCESSING' });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveAttempt = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(approveAttempt.status).toBe(409);
  });

  it('a failed correction construction returns the request to PENDING, never leaves it PROCESSING or falsely APPROVED', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const spy = vi
      .spyOn(DailySalesCorrection, 'create')
      .mockRejectedValueOnce(new Error('simulated correction-build failure'));

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    try {
      const res = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
      expect(res.status).toBe(500);

      const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
      expect(requestDoc.status).toBe('PENDING');
      expect(requestDoc.approvedCorrectionId).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('APPROVED is never observable without a real approved correction record behind it', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // One normal successful approval...
    const submit1 = await submitCleanReport(sales, shopA, product, owner);
    const req1 = await sales.post(`/api/daily-reports/${submit1.body.data.report._id}/corrections`).send(correctionPayload());
    await ownerAgent.post(`/api/correction-requests/${req1.body.data.request._id}/approve`);

    // ...and one that fails partway through, to make sure the invariant
    // holds across both a success and a failure path.
    const submit2 = await sales.post('/api/daily-reports').send(cleanReportPayload(shopA, product, { businessDate: '2020-01-11' }));
    const req2 = await sales.post(`/api/daily-reports/${submit2.body.data.report._id}/corrections`).send(correctionPayload());
    const spy = vi
      .spyOn(DailySalesCorrection, 'create')
      .mockRejectedValueOnce(new Error('simulated correction-build failure'));
    try {
      await ownerAgent.post(`/api/correction-requests/${req2.body.data.request._id}/approve`);
    } finally {
      spy.mockRestore();
    }

    const invalidApproved = await DailyReportCorrectionRequest.find({
      status: 'APPROVED',
      approvedCorrectionId: null,
    });
    expect(invalidApproved).toHaveLength(0);

    const approvedRequests = await DailyReportCorrectionRequest.find({ status: 'APPROVED' });
    for (const req of approvedRequests) {
      const correction = await DailySalesCorrection.findById(req.approvedCorrectionId);
      expect(correction).not.toBeNull();
    }
  });

  it('a successful approval API response is APPROVED with approvedCorrectionId set, never PROCESSING', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.data.request.status).toBe('APPROVED');
    expect(res.body.data.request.status).not.toBe('PROCESSING');
    expect(res.body.data.request.approvedCorrectionId).toBeTruthy();
    expect(res.body.data.request.approvedCorrectionId).toBe(res.body.data.correction._id);

    // The database itself agrees — not just the response body.
    const dbRequest = await DailyReportCorrectionRequest.findById(requestId);
    expect(dbRequest.status).toBe('APPROVED');
    const dbCorrection = await DailySalesCorrection.findById(dbRequest.approvedCorrectionId);
    expect(dbCorrection).not.toBeNull();
  });
});

describe('Resolution-state effective-version isolation', () => {
  it('a fully-reversed resolution against the original never reduces a later correction\'s remaining variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // variantReportPayload: opening 1500, sold 400, expected closing 1100,
    // physical 1097 => variance -3.
    const submitRes = await sales.post('/api/daily-reports').send(variantReportPayload(shopA, product));
    const reportId = submitRes.body.data.report._id;

    // Partially resolve the original variance, then fully reverse it —
    // magnitude must return to zero before any correction can be approved.
    const damageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'partial resolve',
    });
    expect(damageRes.status).toBe(201);
    await ownerAgent
      .post(`/api/stock-variance-resolutions/${damageRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo — miscounted' });

    // Approve a correction that changes the effective variance to -10 (same
    // 400 sold, physical recount now says 1090 instead of 1097).
    const corrReq = await sales.post(`/api/daily-reports/${reportId}/corrections`).send({
      reason: 'physical recount found more missing than first thought',
      proposedSalesLines: [
        { quantity: 250, unitPriceKobo: 1200000 },
        { quantity: 150, unitPriceKobo: 1250000 },
      ],
      proposedPhysicalClosingStockQuantity: 1090,
      proposedActualAmountCollectedKobo: 485000000,
    });
    expect(corrReq.status).toBe(201);
    const approveRes = await ownerAgent.post(`/api/correction-requests/${corrReq.body.data.request._id}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.correction.stockVarianceQuantity).toBe(-10);

    // A brand-new resolution against the corrected (-10) variance must be
    // able to resolve the FULL new magnitude — nothing carried over from
    // the old, already-reversed resolution against the original version.
    const fullResolve = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 10,
      reason: 'full recount shortage against corrected report',
    });
    expect(fullResolve.status).toBe(201);
    expect(fullResolve.body.data.remainingStockVarianceQuantity).toBe(0);
  });

  it('exact scenario: -5 variance, resolve+reverse DAMAGE 2, approve a correction with new variance -3, state resets cleanly', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // opening 1500, sold 400, expected closing 1100, physical 1095 => -5.
    const submitRes = await sales.post('/api/daily-reports').send(
      variantReportPayload(shopA, product, { physicalClosingStockQuantity: 1095 })
    );
    const reportId = submitRes.body.data.report._id;

    // Resolve DAMAGE 2 -> ACTIVE. resolved = 2, remaining = -3.
    const damageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'partial resolve',
    });
    expect(damageRes.status).toBe(201);
    let state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.activeStockVarianceMagnitude).toBe(2);
    expect(state.reservedStockVarianceMagnitude).toBe(0);
    let effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedStockVarianceMagnitude).toBe(2);
    expect(effectiveRes.body.data.unresolvedStockVarianceQuantity).toBe(-3);

    // Reverse DAMAGE 2 -> both zero again. resolved = 0, remaining = -5.
    await ownerAgent
      .post(`/api/stock-variance-resolutions/${damageRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo' });
    state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.activeStockVarianceMagnitude).toBe(0);
    expect(state.reservedStockVarianceMagnitude).toBe(0);
    effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedStockVarianceMagnitude).toBe(0);
    expect(effectiveRes.body.data.unresolvedStockVarianceQuantity).toBe(-5);

    // Approve a correction whose new variance is -3 (same 400 sold,
    // physical recount now says 1097 instead of 1095).
    const corrReq = await sales.post(`/api/daily-reports/${reportId}/corrections`).send({
      reason: 'recount corrected the physical count',
      proposedSalesLines: [
        { quantity: 250, unitPriceKobo: 1200000 },
        { quantity: 150, unitPriceKobo: 1250000 },
      ],
      proposedPhysicalClosingStockQuantity: 1097,
      proposedActualAmountCollectedKobo: 487500000,
    });
    expect(corrReq.status).toBe(201);
    const approveRes = await ownerAgent.post(`/api/correction-requests/${corrReq.body.data.request._id}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.correction.stockVarianceQuantity).toBe(-3);

    state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.effectiveCorrectionId.toString()).toBe(approveRes.body.data.correction._id);
    expect(state.activeStockVarianceMagnitude).toBe(0);
    expect(state.reservedStockVarianceMagnitude).toBe(0);

    // Current effective report: resolved = 0, remaining = -3. The
    // historical DAMAGE/REVERSED resolution against the ORIGINAL version
    // remains visible in history but does not count against the corrected
    // version's discrepancy.
    effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedStockVarianceMagnitude).toBe(0);
    expect(effectiveRes.body.data.unresolvedStockVarianceQuantity).toBe(-3);
    expect(effectiveRes.body.data.stockResolutions).toHaveLength(1);
    expect(effectiveRes.body.data.stockResolutions[0].status).toBe('REVERSED');
    expect(effectiveRes.body.data.stockResolutions[0].quantity).toBe(2);
  });
});

describe('Correction ledger business date (cross-day)', () => {
  it('an approved Day-1 correction never rewrites the Day-2 report snapshot, but does affect the current ledger balance and the Day-1 effective view', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // Day 1 (2020-01-10): opening 1500, sell 400.
    const day1 = await submitCleanReport(sales, shopA, product, owner);
    const day1ReportId = day1.body.data.report._id;

    // Day 2 (2020-01-11): sell another 100 against the 1100 remaining.
    const day2 = await sales.post('/api/daily-reports').send(
      cleanReportPayload(shopA, product, {
        businessDate: '2020-01-11',
        salesLines: [{ quantity: 100, unitPriceKobo: 1200000 }],
        physicalClosingStockQuantity: 1000,
        actualAmountCollectedKobo: 120000000,
      })
    );
    expect(day2.status).toBe(201);
    const day2ReportId = day2.body.data.report._id;
    const day2SnapshotBefore = day2.body.data.report;

    expect(await getInventoryBalance(shopA._id, product._id)).toBe(1500 - 400 - 100);

    // Correct Day 1's sale from 400 to 390 (data entry mistake found later,
    // after Day 2 has already been submitted and closed).
    const corrReq = await sales.post(`/api/daily-reports/${day1ReportId}/corrections`).send(correctionPayload());
    const approveRes = await ownerAgent.post(`/api/correction-requests/${corrReq.body.data.request._id}/approve`);
    expect(approveRes.status).toBe(200);

    // Day 2's stored snapshot is a frozen historical fact — it must not
    // silently change even though a later-approved Day-1 correction altered
    // net ledger movement that a live recalculation would now see
    // differently.
    const day2Check = await ownerAgent.get(`/api/daily-reports/${day2ReportId}`);
    expect(day2Check.body.data.report.openingStockQuantity).toBe(day2SnapshotBefore.openingStockQuantity);
    expect(day2Check.body.data.report.availableStockQuantity).toBe(day2SnapshotBefore.availableStockQuantity);
    expect(day2Check.body.data.report.totalQuantitySold).toBe(100);
    expect(day2Check.body.data.report.updatedAt).toBe(day2SnapshotBefore.updatedAt);

    // The current official ledger balance DOES reflect the correction.
    expect(await getInventoryBalance(shopA._id, product._id)).toBe(1500 - 390 - 100);

    // The Day-1 effective report reflects the correction.
    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${day1ReportId}/effective`);
    expect(effectiveRes.body.data.effective.totalQuantitySold).toBe(390);

    // The correction's ledger effects are dated on Day 1's own businessDate
    // (this is a deliberate choice for correction effects, distinct from
    // stock-variance-resolution's CASE A/B posting-date rules — see README
    // "Correction ledger business date").
    const reversal = await InventoryTransaction.findById(
      approveRes.body.data.correction.reversalInventoryTransactionId
    );
    expect(reversal.businessDate).toBe('2020-01-10');
    const replacement = await InventoryTransaction.findById(
      approveRes.body.data.correction.replacementSaleInventoryTransactionId
    );
    expect(replacement.businessDate).toBe('2020-01-10');
  });
});

describe('DailySalesReport immutability (correction approval)', () => {
  it('never modifies the original DailySalesReport document — a correction only ever creates a new DailySalesCorrection', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitCleanReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const before = (await DailySalesReport.findById(reportId)).toObject();

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const approveRes = await ownerAgent.post(`/api/correction-requests/${reqRes.body.data.request._id}/approve`);
    expect(approveRes.status).toBe(200);

    const after = (await DailySalesReport.findById(reportId)).toObject();
    expect(after).toEqual(before);

    // The correction is a wholly separate document.
    const correctionCount = await DailySalesCorrection.countDocuments({ dailySalesReportId: reportId });
    expect(correctionCount).toBe(1);
  });
});
