import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { loginAgent } from './factories.js';
import { setupShopWithUsers, createOpeningStockDirect, variantReportPayload } from './dailyReportFixtures.js';
import { DailyReportCorrectionRequest } from '../src/models/DailyReportCorrectionRequest.js';
import { DailySalesCorrection } from '../src/models/DailySalesCorrection.js';
import { DailyReportResolutionState } from '../src/models/DailyReportResolutionState.js';
import mongoose from 'mongoose';
import { claimCorrectionProcessingLock } from '../src/services/dailyReportResolutionStateService.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function submitNegativeVarianceReport(salesAgent, shop, product, owner) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(variantReportPayload(shop, product));
}

function correctionPayload(overrides = {}) {
  return {
    reason: 'Salesperson miscounted bags sold',
    proposedSalesLines: [
      { quantity: 250, unitPriceKobo: 1200000 },
      { quantity: 150, unitPriceKobo: 1250000 },
    ],
    proposedPhysicalClosingStockQuantity: 1097,
    proposedActualAmountCollectedKobo: 485000000,
    ...overrides,
  };
}

describe('Cross-workflow concurrency: correction claims lock first', () => {
  it('A. blocks a stock resolution while a correction holds the lock', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const fakeCorrectionRequestId = new mongoose.Types.ObjectId();
    await claimCorrectionProcessingLock(reportId, null, fakeCorrectionRequestId);

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'attempt while correction lock held',
    });
    expect(res.status).toBe(409);

    // The lock is untouched by the blocked attempt.
    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.correctionProcessing).toBe(true);
    expect(state.reservedStockVarianceMagnitude).toBe(0);
  });

  it('B. blocks a money resolution while a correction holds the lock', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const fakeCorrectionRequestId = new mongoose.Types.ObjectId();
    await claimCorrectionProcessingLock(reportId, null, fakeCorrectionRequestId);

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000,
      reason: 'attempt while correction lock held',
    });
    expect(res.status).toBe(409);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.correctionProcessing).toBe(true);
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
  });
});

describe('Cross-workflow concurrency: resolution reserves first', () => {
  it('C. a real ACTIVE stock resolution blocks correction approval with 409, before any correction effects are built', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner); // variance -3
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // A correction request is filed while the report is still clean...
    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(reqRes.status).toBe(201);
    const requestId = reqRes.body.data.request._id;

    // ...then, before it's approved, a real stock resolution fully resolves
    // the variance (allowed — correctionProcessing is still false).
    const resolveRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 3,
      reason: 'full resolve before correction approval',
    });
    expect(resolveRes.status).toBe(201);

    // Now the correction cannot be approved — it must not silently ignore
    // the resolution that now exists.
    const approveRes = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(approveRes.status).toBe(409);

    const correctionCount = await DailySalesCorrection.countDocuments({ dailySalesReportId: reportId });
    expect(correctionCount).toBe(0);

    // The request itself is untouched (still PENDING — the friendly
    // hasAnyResolutionActivity check fires before the lock is even
    // attempted, so it was never claimed to begin with).
    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('PENDING');
  });

  it('D. a real ACTIVE money resolution blocks correction approval with 409', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner); // money variance -2,500,000
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    expect(reqRes.status).toBe(201);
    const requestId = reqRes.body.data.request._id;

    const resolveRes = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'ACCEPTED_SHORTAGE',
      amountKobo: 2500000,
      reason: 'full resolve before correction approval',
    });
    expect(resolveRes.status).toBe(201);

    const approveRes = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(approveRes.status).toBe(409);

    const correctionCount = await DailySalesCorrection.countDocuments({ dailySalesReportId: reportId });
    expect(correctionCount).toBe(0);

    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('PENDING');
  });
});

describe('Cross-workflow concurrency: lock lifecycle on failure', () => {
  it('E. a failed correction construction releases the lock and returns the request to PENDING, unblocking resolutions', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    const spy = vi
      .spyOn(DailySalesCorrection, 'create')
      .mockRejectedValueOnce(new Error('simulated correction-build failure'));

    try {
      const res = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('PENDING');

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.correctionProcessing).toBe(false);
    expect(state.correctionProcessingRequestId).toBeNull();

    // The lock being released for real (not just the request status) is
    // proven by a stock resolution now succeeding.
    const resolveRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'should succeed now that the lock is released',
    });
    expect(resolveRes.status).toBe(201);
  });
});

describe('Cross-workflow concurrency: stranded lock state (simulated hard crash)', () => {
  it('F. a stranded PROCESSING request + held lock blocks stock resolution, money resolution, and re-approval, and is never silently cleared', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const reqRes = await sales.post(`/api/daily-reports/${reportId}/corrections`).send(correctionPayload());
    const requestId = reqRes.body.data.request._id;

    // Simulate a hard crash exactly at "PENDING->PROCESSING claimed, lock
    // claimed, nothing else happened yet" — directly, without relying on
    // real timing.
    await DailyReportCorrectionRequest.updateOne({ _id: requestId }, { status: 'PROCESSING' });
    await claimCorrectionProcessingLock(reportId, null, requestId);

    // Stock resolution blocked.
    const stockRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'should be blocked',
    });
    expect(stockRes.status).toBe(409);

    // Money resolution blocked.
    const moneyRes = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000,
      reason: 'should be blocked',
    });
    expect(moneyRes.status).toBe(409);

    // A second approval attempt against the same stranded request is
    // blocked too (still PROCESSING, not PENDING).
    const reapproveRes = await ownerAgent.post(`/api/correction-requests/${requestId}/approve`);
    expect(reapproveRes.status).toBe(409);

    // Nothing was silently cleared by any of the blocked attempts above.
    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.correctionProcessing).toBe(true);
    expect(state.correctionProcessingRequestId.toString()).toBe(requestId.toString());
    expect(state.reservedStockVarianceMagnitude).toBe(0);
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);

    const requestDoc = await DailyReportCorrectionRequest.findById(requestId);
    expect(requestDoc.status).toBe('PROCESSING');
  });
});
