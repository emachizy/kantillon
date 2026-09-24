import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { loginAgent } from './factories.js';
import { setupShopWithUsers, createOpeningStockDirect, variantReportPayload } from './dailyReportFixtures.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { MoneyVarianceResolution } from '../src/models/MoneyVarianceResolution.js';
import { DailySalesReport } from '../src/models/DailySalesReport.js';
import { DailyReportResolutionState } from '../src/models/DailyReportResolutionState.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

// Negative money variance fixture: expected revenue ₦4,875,000, collected
// ₦4,850,000 => variance -₦25,000 (2,500,000 kobo), matching the spec.
async function submitNegativeMoneyVarianceReport(salesAgent, shop, product, owner) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(variantReportPayload(shop, product));
}

async function submitPositiveMoneyVarianceReport(salesAgent, shop, product, owner) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(
    variantReportPayload(shop, product, { actualAmountCollectedKobo: 490000000 }) // +2,500,000
  );
}

describe('POST /api/daily-reports/:id/money-variance-resolutions', () => {
  it('partially resolves a negative money variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered from till float',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.remainingMoneyVarianceKobo).toBe(-1500000);
  });

  it('partially resolves a positive money variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitPositiveMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'EXCESS_CONFIRMED',
      amountKobo: 1000000,
      reason: 'confirmed excess',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.remainingMoneyVarianceKobo).toBe(1500000);
  });

  it('rejects a resolution when money variance is zero', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(
      variantReportPayload(shopA, product, { actualAmountCollectedKobo: 487500000 })
    );
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1,
      reason: 'no variance',
    });
    expect(res.status).toBe(409);
  });

  it('matches the worked example: RECOVERED 10,000 then ACCEPTED_SHORTAGE 15,000 fully resolves -25,000', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const first = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered',
    });
    expect(first.body.data.remainingMoneyVarianceKobo).toBe(-1500000);

    const second = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'ACCEPTED_SHORTAGE',
      amountKobo: 1500000,
      reason: 'accepted the rest',
    });
    expect(second.body.data.remainingMoneyVarianceKobo).toBe(0);

    const report = await DailySalesReport.findById(reportId);
    expect(report.stockVarianceQuantity).toBe(-3); // untouched
  });

  it('cannot resolve more than the remaining amount', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered',
    });

    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'ACCEPTED_SHORTAGE',
      amountKobo: 2000000, // only 1,500,000 remains
      reason: 'too much',
    });
    expect(res.status).toBe(409);
  });

  it('creates no InventoryTransaction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const beforeCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id });
    await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered',
    });
    const afterCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id });
    expect(afterCount).toBe(beforeCount);
  });

  it('preserves safe integer kobo exactly (no floating-point drift)', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 999999,
      reason: 'odd amount',
    });
    expect(res.body.data.resolution.amountKobo).toBe(999999);
    expect(res.body.data.remainingMoneyVarianceKobo).toBe(-(2500000 - 999999));
  });

  it('only OWNER may create a money variance resolution', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'not allowed',
    });
    expect(res.status).toBe(403);
  });

  it('creates a MONEY_VARIANCE_RESOLVED audit entry', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    await ownerAgent.post(`/api/daily-reports/${submitRes.body.data.report._id}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered',
    });
    const entry = await AuditLog.findOne({ action: 'MONEY_VARIANCE_RESOLVED' });
    expect(entry).not.toBeNull();
  });

  it('under real concurrency, two simultaneous resolutions cannot together over-resolve the variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner); // -2,500,000
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const [first, second] = await Promise.all([
      ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
        resolutionType: 'RECOVERED',
        amountKobo: 2000000,
        reason: 'first',
      }),
      ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
        resolutionType: 'ACCEPTED_SHORTAGE',
        amountKobo: 2000000,
        reason: 'second',
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(
      state.reservedMoneyVarianceMagnitudeKobo + state.activeMoneyVarianceMagnitudeKobo
    ).toBeLessThanOrEqual(2500000);
  });
});

describe('POST /api/money-variance-resolutions/:id/reverse', () => {
  it('lets OWNER reverse and reopens the remaining amount, with no InventoryTransaction created', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 2500000,
      reason: 'full recovery',
    });

    const beforeTxnCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id });

    const reverseRes = await ownerAgent
      .post(`/api/money-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'mistaken entry' });
    expect(reverseRes.status).toBe(200);
    expect(reverseRes.body.data.resolution.status).toBe('REVERSED');

    const afterTxnCount = await InventoryTransaction.countDocuments({ shopId: shopA._id, productId: product._id });
    expect(afterTxnCount).toBe(beforeTxnCount);

    // Reversal decreases ACTIVE, never touches RESERVED.
    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.activeMoneyVarianceMagnitudeKobo).toBe(0);
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
  });

  it('cannot reverse the same resolution twice', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/money-variance-resolutions`)
      .send({ resolutionType: 'RECOVERED', amountKobo: 2500000, reason: 'full recovery' });

    await ownerAgent
      .post(`/api/money-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'first' });
    const second = await ownerAgent
      .post(`/api/money-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'second' });
    expect(second.status).toBe(409);
  });

  it('reversing a nonexistent resolution returns 404', async () => {
    await setupShopWithUsers();
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent
      .post('/api/money-variance-resolutions/650000000000000000000000/reverse')
      .send({ reason: 'no' });
    expect(res.status).toBe(404);
  });

  it('creates a MONEY_VARIANCE_RESOLUTION_REVERSED audit entry', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/money-variance-resolutions`)
      .send({ resolutionType: 'RECOVERED', amountKobo: 2500000, reason: 'full recovery' });
    await ownerAgent
      .post(`/api/money-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo' });

    const entry = await AuditLog.findOne({ action: 'MONEY_VARIANCE_RESOLUTION_REVERSED' });
    expect(entry).not.toBeNull();
  });
});

describe('Money resolution compensation', () => {
  it('a forced record-creation failure leaves no resolution and never reserves', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const spy = vi
      .spyOn(MoneyVarianceResolution, 'create')
      .mockRejectedValueOnce(new Error('simulated write failure'));

    try {
      const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
        resolutionType: 'RECOVERED',
        amountKobo: 1000000,
        reason: 'recovered',
      });
      expect(res.status).toBe(500);

      const orphan = await MoneyVarianceResolution.findOne({ dailySalesReportId: reportId });
      expect(orphan).toBeNull();

      const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
      expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
      expect(state.activeMoneyVarianceMagnitudeKobo).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('a forced activation failure after a successful reservation gives back the reservation and deletes the record', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // The record is created (PROCESSING) and the reservation succeeds
    // before this fails — the PROCESSING->ACTIVE activation write.
    const spy = vi
      .spyOn(MoneyVarianceResolution, 'updateOne')
      .mockRejectedValueOnce(new Error('simulated activation failure'));

    try {
      const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
        resolutionType: 'RECOVERED',
        amountKobo: 1000000,
        reason: 'recovered',
      });
      expect(res.status).toBe(500);

      const orphan = await MoneyVarianceResolution.findOne({ dailySalesReportId: reportId });
      expect(orphan).toBeNull();

      const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
      expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0); // reservation given back
      expect(state.activeMoneyVarianceMagnitudeKobo).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('DailySalesReport immutability (money variance resolutions)', () => {
  it('never modifies the DailySalesReport document', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const before = (await DailySalesReport.findById(reportId)).toObject();

    const createRes = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 2500000,
      reason: 'full recovery',
    });
    expect(createRes.status).toBe(201);

    await ownerAgent
      .post(`/api/money-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo' });

    const after = (await DailySalesReport.findById(reportId)).toObject();
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('resolvedStockVarianceMagnitude');
    expect(after).not.toHaveProperty('resolvedMoneyVarianceMagnitudeKobo');
  });
});

describe('Reserved vs active state transitions', () => {
  it('a successful resolution moves its amount from reserved to active, never leaving both non-zero', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'recovered',
    });
    expect(res.status).toBe(201);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
    expect(state.activeMoneyVarianceMagnitudeKobo).toBe(1000000);
  });

  it('a PROCESSING (crash-stranded) resolution does not count as ACTIVE resolved amount', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      reservedMoneyVarianceMagnitudeKobo: 1000000,
      activeMoneyVarianceMagnitudeKobo: 0,
    });
    await MoneyVarianceResolution.create({
      dailySalesReportId: reportId,
      shopId: shopA._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'stranded by a simulated crash',
      status: 'PROCESSING',
      resolvedBy: owner._id,
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedMoneyVarianceMagnitudeKobo).toBe(0);
    expect(effectiveRes.body.data.processingMoneyResolutionMagnitudeKobo).toBe(1000000);
    expect(effectiveRes.body.data.unresolvedMoneyVarianceKobo).toBe(-2500000);
  });

  it('a PROCESSING resolution cannot be reversed through the normal endpoint', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const stranded = await MoneyVarianceResolution.create({
      dailySalesReportId: reportId,
      shopId: shopA._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'RECOVERED',
      amountKobo: 1000000,
      reason: 'stranded by a simulated crash',
      status: 'PROCESSING',
      resolvedBy: owner._id,
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent
      .post(`/api/money-variance-resolutions/${stranded._id}/reverse`)
      .send({ reason: 'attempt to reverse a stranded PROCESSING record' });
    expect(res.status).toBe(409);

    const stillProcessing = await MoneyVarianceResolution.findById(stranded._id);
    expect(stillProcessing.status).toBe('PROCESSING');
  });
});

describe('Business-truth aggregation source', () => {
  it('resolvedMoneyVarianceMagnitudeKobo counts only ACTIVE resolutions for the current effective version — never REVERSED or PROCESSING', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeMoneyVarianceReport(sales, shopA, product, owner); // -2,500,000
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const activeRes = await ownerAgent.post(`/api/daily-reports/${reportId}/money-variance-resolutions`).send({
      resolutionType: 'RECOVERED',
      amountKobo: 500000,
      reason: 'real active resolution',
    });
    expect(activeRes.status).toBe(201);

    await MoneyVarianceResolution.create({
      dailySalesReportId: reportId,
      dailySalesCorrectionId: null,
      shopId: shopA._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'RECOVERED',
      amountKobo: 700000,
      reason: 'historical, already reversed',
      status: 'REVERSED',
      resolvedBy: owner._id,
    });

    await MoneyVarianceResolution.create({
      dailySalesReportId: reportId,
      dailySalesCorrectionId: null,
      shopId: shopA._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'RECOVERED',
      amountKobo: 900000,
      reason: 'crash-stranded, still processing',
      status: 'PROCESSING',
      resolvedBy: owner._id,
    });

    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedMoneyVarianceMagnitudeKobo).toBe(500000);
    expect(effectiveRes.body.data.unresolvedMoneyVarianceKobo).toBe(-2000000);
    expect(effectiveRes.body.data.moneyResolutions).toHaveLength(3);
  });
});
