import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { loginAgent, createTestShop } from './factories.js';
import { setupShopWithUsers, createOpeningStockDirect, variantReportPayload } from './dailyReportFixtures.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { StockVarianceResolution } from '../src/models/StockVarianceResolution.js';
import { DailySalesReport } from '../src/models/DailySalesReport.js';
import { DailyReportResolutionState } from '../src/models/DailyReportResolutionState.js';
import { getInventoryBalance } from '../src/services/inventoryService.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

// Negative variance fixture: opening 1500, sold 400, expected closing 1100,
// physical 1097 => variance -3 (matches the spec's worked example).
async function submitNegativeVarianceReport(salesAgent, shop, product, owner) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(variantReportPayload(shop, product));
}

// Positive variance fixture: opening 1500, sold 400, expected closing 1100,
// physical 1104 => variance +4.
async function submitPositiveVarianceReport(salesAgent, shop, product, owner) {
  await createOpeningStockDirect(shop, product, owner, 1500, '2020-01-10');
  return salesAgent.post('/api/daily-reports').send(
    variantReportPayload(shop, product, { physicalClosingStockQuantity: 1104 })
  );
}

describe('POST /api/daily-reports/:id/stock-variance-resolutions', () => {
  it('accepts DAMAGE against a negative variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: '2 bags damaged in transit',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.remainingStockVarianceQuantity).toBe(-1);
  });

  it('accepts SHORTAGE against a negative variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 1,
      reason: 'confirmed missing',
    });
    expect(res.status).toBe(201);
  });

  it('rejects SURPLUS against a negative variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SURPLUS',
      quantity: 1,
      reason: 'wrong type',
    });
    expect(res.status).toBe(400);
  });

  it('accepts SURPLUS against a positive variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitPositiveVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SURPLUS',
      quantity: 4,
      reason: 'extra bags found',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.remainingStockVarianceQuantity).toBe(0);
  });

  it('rejects DAMAGE/SHORTAGE against a positive variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitPositiveVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const damageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'wrong type',
    });
    expect(damageRes.status).toBe(400);

    const shortageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 1,
      reason: 'wrong type',
    });
    expect(shortageRes.status).toBe(400);
  });

  it('rejects a resolution when the report has zero variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(
      variantReportPayload(shopA, product, { physicalClosingStockQuantity: 1100 })
    );
    const reportId = submitRes.body.data.report._id;

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 1,
      reason: 'no variance exists',
    });
    expect(res.status).toBe(409);
  });

  it('matches the worked example: DAMAGE 2 then SHORTAGE 1 fully resolves -3', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const balanceBefore = await getInventoryBalance(shopA._id, product._id); // 1100

    const damageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: '2 bags damaged',
    });
    expect(damageRes.status).toBe(201);
    expect(await getInventoryBalance(shopA._id, product._id)).toBe(balanceBefore - 2);
    expect(damageRes.body.data.remainingStockVarianceQuantity).toBe(-1);

    const shortageRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 1,
      reason: '1 bag missing',
    });
    expect(shortageRes.status).toBe(201);
    expect(await getInventoryBalance(shopA._id, product._id)).toBe(balanceBefore - 3);
    expect(shortageRes.body.data.remainingStockVarianceQuantity).toBe(0);

    // The original report's stored variance never changes.
    const reportCheck = await ownerAgent.get(`/api/daily-reports/${reportId}`);
    expect(reportCheck.body.data.report.stockVarianceQuantity).toBe(-3);
  });

  it('cannot resolve more than the remaining variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'first',
    });

    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 2, // only 1 remains
      reason: 'too much',
    });
    expect(res.status).toBe(409);
  });

  it('only OWNER can create a stock variance resolution', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const res = await sales.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'not allowed',
    });
    expect(res.status).toBe(403);
  });

  it('DAMAGE and SHORTAGE create APPROVED OUT transactions; SURPLUS creates an APPROVED IN transaction', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const negRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const damageRes = await ownerAgent
      .post(`/api/daily-reports/${negRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'DAMAGE', quantity: 2, reason: 'damage' });
    const damageTxn = await InventoryTransaction.findById(damageRes.body.data.transaction._id);
    expect(damageTxn.type).toBe('DAMAGE');
    expect(damageTxn.direction).toBe('OUT');
    expect(damageTxn.status).toBe('APPROVED');

    // Reuse the same owner/product for a second shop+report rather than
    // calling setupShopWithUsers() again, which would try to recreate the
    // same fixed test emails within one test (no clearTestDb in between).
    const shopA2 = await createTestShop({ name: 'Shop A2' });
    const posRes = await submitPositiveVarianceReport(ownerAgent, shopA2, product, owner);
    const surplusRes = await ownerAgent
      .post(`/api/daily-reports/${posRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'SURPLUS', quantity: 4, reason: 'surplus' });
    const surplusTxn = await InventoryTransaction.findById(surplusRes.body.data.transaction._id);
    expect(surplusTxn.type).toBe('SURPLUS');
    expect(surplusTxn.direction).toBe('IN');
  });

  it('creates a STOCK_VARIANCE_RESOLVED audit entry', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    await ownerAgent.post(`/api/daily-reports/${submitRes.body.data.report._id}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'damage',
    });

    const entry = await AuditLog.findOne({ action: 'STOCK_VARIANCE_RESOLVED' });
    expect(entry).not.toBeNull();
  });

  it('under real concurrency, two simultaneous resolutions cannot together over-resolve the variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner); // variance -3
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const [first, second] = await Promise.all([
      ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
        resolutionType: 'DAMAGE',
        quantity: 2,
        reason: 'first',
      }),
      ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
        resolutionType: 'SHORTAGE',
        quantity: 2,
        reason: 'second',
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Both could fit if requests were sequential (2+1 <= 3), but two
    // concurrent quantity-2 requests together (4) exceed the magnitude (3)
    // — exactly one must be rejected.
    expect(statuses).toEqual([201, 409]);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.reservedStockVarianceMagnitude + state.activeStockVarianceMagnitude).toBeLessThanOrEqual(3);
  });
});

describe('POST /api/stock-variance-resolutions/:id/reverse', () => {
  it('lets OWNER reverse a resolution, posting an opposing transaction and reopening the variance', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const balanceBefore = await getInventoryBalance(shopA._id, product._id);
    const createRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'SHORTAGE',
      quantity: 3,
      reason: 'full shortage',
    });
    expect(await getInventoryBalance(shopA._id, product._id)).toBe(balanceBefore - 3);

    const reverseRes = await ownerAgent
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'miscounted, no actual shortage' });
    expect(reverseRes.status).toBe(200);
    expect(reverseRes.body.data.resolution.status).toBe('REVERSED');

    const reversalTxn = reverseRes.body.data.reversalTransaction;
    expect(reversalTxn.type).toBe('REVERSAL');
    expect(reversalTxn.direction).toBe('IN'); // opposes the original OUT

    expect(await getInventoryBalance(shopA._id, product._id)).toBe(balanceBefore);

    // Reversal decreases ACTIVE, never touches RESERVED (there was none to
    // touch here — the resolution already completed before being reversed).
    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.activeStockVarianceMagnitude).toBe(0);
    expect(state.reservedStockVarianceMagnitude).toBe(0);
  });

  it('cannot reverse the same resolution twice', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'SHORTAGE', quantity: 3, reason: 'full shortage' });

    await ownerAgent
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'first reversal' });
    const second = await ownerAgent
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'second reversal' });
    expect(second.status).toBe(409);
  });

  it('non-owner cannot reverse', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'SHORTAGE', quantity: 3, reason: 'full shortage' });

    const res = await sales
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'no' });
    expect(res.status).toBe(403);
  });

  it('reversing a nonexistent resolution returns 404', async () => {
    await setupShopWithUsers();
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent
      .post('/api/stock-variance-resolutions/650000000000000000000000/reverse')
      .send({ reason: 'no' });
    expect(res.status).toBe(404);
  });

  it('creates a STOCK_VARIANCE_RESOLUTION_REVERSED audit entry', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'SHORTAGE', quantity: 3, reason: 'full shortage' });
    await ownerAgent
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo' });

    const entry = await AuditLog.findOne({ action: 'STOCK_VARIANCE_RESOLUTION_REVERSED' });
    expect(entry).not.toBeNull();
  });

  it('under real concurrency, exactly one of two simultaneous reversal requests succeeds', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const createRes = await ownerAgent
      .post(`/api/daily-reports/${submitRes.body.data.report._id}/stock-variance-resolutions`)
      .send({ resolutionType: 'SHORTAGE', quantity: 3, reason: 'full shortage' });
    const resolutionId = createRes.body.data.resolution._id;

    const [first, second] = await Promise.all([
      ownerAgent.post(`/api/stock-variance-resolutions/${resolutionId}/reverse`).send({ reason: 'a' }),
      ownerAgent.post(`/api/stock-variance-resolutions/${resolutionId}/reverse`).send({ reason: 'b' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('Stock resolution compensation', () => {
  it('a forced ledger transaction failure leaves no valid-looking resolution and returns the reservation', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const spy = vi
      .spyOn(InventoryTransaction, 'create')
      .mockRejectedValueOnce(new Error('simulated ledger failure'));

    try {
      const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
        resolutionType: 'DAMAGE',
        quantity: 2,
        reason: 'damage',
      });
      expect(res.status).toBe(500);

      const orphanResolution = await StockVarianceResolution.findOne({ dailySalesReportId: reportId });
      expect(orphanResolution).toBeNull();

      const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
      expect(state.reservedStockVarianceMagnitude).toBe(0); // reservation given back
      expect(state.activeStockVarianceMagnitude).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('a forced activation failure after the ledger transaction and reservation both succeed reverts everything', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // Reservation and the ledger transaction both succeed before this
    // fails — the PROCESSING->ACTIVE activation write.
    const spy = vi
      .spyOn(StockVarianceResolution, 'updateOne')
      .mockRejectedValueOnce(new Error('simulated activation failure'));

    try {
      const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
        resolutionType: 'DAMAGE',
        quantity: 2,
        reason: 'damage',
      });
      expect(res.status).toBe(500);

      const orphanResolution = await StockVarianceResolution.findOne({ dailySalesReportId: reportId });
      expect(orphanResolution).toBeNull();

      const orphanTransactions = await InventoryTransaction.countDocuments({
        shopId: shopA._id,
        productId: product._id,
        type: 'DAMAGE',
      });
      expect(orphanTransactions).toBe(0);

      const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
      expect(state.activeStockVarianceMagnitude).toBe(0);
      expect(state.reservedStockVarianceMagnitude).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('DailySalesReport immutability (stock variance resolutions)', () => {
  it('never modifies the DailySalesReport document', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const before = (await DailySalesReport.findById(reportId)).toObject();

    const createRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'damage',
    });
    expect(createRes.status).toBe(201);

    await ownerAgent
      .post(`/api/stock-variance-resolutions/${createRes.body.data.resolution._id}/reverse`)
      .send({ reason: 'undo' });

    const after = (await DailySalesReport.findById(reportId)).toObject();
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('resolvedStockVarianceMagnitude');
    expect(after).not.toHaveProperty('resolvedMoneyVarianceMagnitudeKobo');
  });
});

describe('Reserved vs active state transitions', () => {
  it('a successful resolution moves its quantity from reserved to active, never leaving both non-zero', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const res = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 2,
      reason: 'damage',
    });
    expect(res.status).toBe(201);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.reservedStockVarianceMagnitude).toBe(0);
    expect(state.activeStockVarianceMagnitude).toBe(2);
  });

  it('a PROCESSING (crash-stranded) resolution does not count as ACTIVE resolved amount', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    // Simulate a hard-crash-stranded PROCESSING resolution directly,
    // without going through the normal (compensating) failure path —
    // exactly what a real crash between the reservation and activation
    // steps would leave behind.
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      reservedStockVarianceMagnitude: 2,
      activeStockVarianceMagnitude: 0,
    });
    await StockVarianceResolution.create({
      dailySalesReportId: reportId,
      shopId: shopA._id,
      productId: product._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'DAMAGE',
      quantity: 2,
      direction: 'OUT',
      reason: 'stranded by a simulated crash',
      status: 'PROCESSING',
      resolvedBy: owner._id,
      postingBusinessDate: '2020-01-10',
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    expect(effectiveRes.body.data.resolvedStockVarianceMagnitude).toBe(0);
    expect(effectiveRes.body.data.processingStockResolutionMagnitude).toBe(2);
    // The full -3 variance is still shown as unresolved — the 2 reserved
    // (but not yet active) bags are never subtracted from it.
    expect(effectiveRes.body.data.unresolvedStockVarianceQuantity).toBe(-3);
  });

  it('a PROCESSING resolution cannot be reversed through the normal endpoint', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner);
    const reportId = submitRes.body.data.report._id;

    const stranded = await StockVarianceResolution.create({
      dailySalesReportId: reportId,
      shopId: shopA._id,
      productId: product._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'DAMAGE',
      quantity: 2,
      direction: 'OUT',
      reason: 'stranded by a simulated crash',
      status: 'PROCESSING',
      resolvedBy: owner._id,
      postingBusinessDate: '2020-01-10',
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent
      .post(`/api/stock-variance-resolutions/${stranded._id}/reverse`)
      .send({ reason: 'attempt to reverse a stranded PROCESSING record' });
    expect(res.status).toBe(409);

    const stillProcessing = await StockVarianceResolution.findById(stranded._id);
    expect(stillProcessing.status).toBe('PROCESSING');
  });
});

describe('Business-truth aggregation source', () => {
  it('resolvedStockVarianceMagnitude counts only ACTIVE resolutions for the current effective version — never REVERSED or PROCESSING', async () => {
    const { shopA, product, owner } = await setupShopWithUsers();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitNegativeVarianceReport(sales, shopA, product, owner); // variance -3
    const reportId = submitRes.body.data.report._id;
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // One real ACTIVE resolution (quantity 1).
    const activeRes = await ownerAgent.post(`/api/daily-reports/${reportId}/stock-variance-resolutions`).send({
      resolutionType: 'DAMAGE',
      quantity: 1,
      reason: 'real active resolution',
    });
    expect(activeRes.status).toBe(201);

    // A REVERSED resolution inserted directly (simulates history from an
    // earlier, already-undone resolution).
    await StockVarianceResolution.create({
      dailySalesReportId: reportId,
      dailySalesCorrectionId: null,
      shopId: shopA._id,
      productId: product._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'DAMAGE',
      quantity: 5,
      direction: 'OUT',
      reason: 'historical, already reversed',
      status: 'REVERSED',
      resolvedBy: owner._id,
      postingBusinessDate: '2020-01-10',
    });

    // A PROCESSING resolution inserted directly (simulates a crash-stranded
    // in-flight attempt).
    await StockVarianceResolution.create({
      dailySalesReportId: reportId,
      dailySalesCorrectionId: null,
      shopId: shopA._id,
      productId: product._id,
      sourceBusinessDate: '2020-01-10',
      resolutionType: 'DAMAGE',
      quantity: 9,
      direction: 'OUT',
      reason: 'crash-stranded, still processing',
      status: 'PROCESSING',
      resolvedBy: owner._id,
      postingBusinessDate: '2020-01-10',
    });

    const effectiveRes = await ownerAgent.get(`/api/daily-reports/${reportId}/effective`);
    // Only the one real ACTIVE resolution (quantity 1) counts — the
    // REVERSED (5) and PROCESSING (9) records are excluded entirely.
    expect(effectiveRes.body.data.resolvedStockVarianceMagnitude).toBe(1);
    expect(effectiveRes.body.data.unresolvedStockVarianceQuantity).toBe(-2);
    // All three remain visible in history.
    expect(effectiveRes.body.data.stockResolutions).toHaveLength(3);
  });
});
