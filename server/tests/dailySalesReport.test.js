import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { ROLES } from '../src/utils/constants.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { DailySalesReport } from '../src/models/DailySalesReport.js';
import { getLagosBusinessDate } from '../src/utils/businessDate.js';
import { getInventoryBalance } from '../src/services/inventoryService.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function setup() {
  const shopA = await createTestShop({ name: 'Shop A' });
  const shopB = await createTestShop({ name: 'Shop B' });
  const product = await createTestProduct();
  const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
  const manager = await createTestUser({
    role: ROLES.MANAGER,
    email: 'manager@test.dev',
    shopIds: [shopA._id],
  });
  const salesperson = await createTestUser({
    role: ROLES.SALESPERSON,
    email: 'sales@test.dev',
    shopIds: [shopA._id],
  });
  return { shopA, shopB, product, owner, manager, salesperson };
}

// Direct ledger fixture, bypassing the opening-stock API (which always
// stamps today's real date) so tests can control businessDate precisely
// for multi-day scenarios — same pattern as tests/inventoryBalance.test.js.
async function createOpeningStockDirect(shop, product, owner, quantity, businessDate) {
  return InventoryTransaction.create({
    shopId: shop._id,
    productId: product._id,
    type: 'OPENING_STOCK',
    direction: 'IN',
    quantity,
    status: 'APPROVED',
    createdBy: owner._id,
    approvedBy: owner._id,
    approvedAt: new Date(),
    referenceType: 'OPENING_STOCK',
    businessDate,
  });
}

// Real API flow (submit + approve) for a stock receipt on a specific
// business date — submitStockReceipt accepts an explicit businessDate.
async function receiveAndApproveStock(ownerAgent, salesAgent, shop, product, quantity, businessDate) {
  const submitRes = await salesAgent.post('/api/stock-receipts').send({
    shopId: shop._id.toString(),
    productId: product._id.toString(),
    quantity,
    businessDate,
  });
  expect(submitRes.status).toBe(201);
  const approveRes = await ownerAgent.post(
    `/api/stock-receipts/${submitRes.body.data.receipt._id}/approve`
  );
  expect(approveRes.status).toBe(200);
  return submitRes.body.data.receipt;
}

function reportPayload(shop, product, overrides = {}) {
  return {
    shopId: shop._id.toString(),
    productId: product._id.toString(),
    businessDate: '2020-01-10',
    salesLines: [{ quantity: 250, unitPriceKobo: 1200000 }],
    physicalClosingStockQuantity: 750,
    actualAmountCollectedKobo: 300000000,
    ...overrides,
  };
}

describe('POST /api/daily-reports — basic access', () => {
  it('lets an assigned salesperson submit a daily report', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    expect(res.status).toBe(201);
    expect(res.body.data.report.status).toBe('SUBMITTED');
  });

  it('lets a manager submit for their assigned shop', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const manager = await loginAgent(app, 'manager@test.dev');

    const res = await manager.post('/api/daily-reports').send(reportPayload(shopA, product));
    expect(res.status).toBe(201);
  });

  it('rejects a salesperson submitting for a shop they are not assigned to', async () => {
    const { shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(reportPayload(shopB, product));
    expect(res.status).toBe(403);
  });

  it('rejects an ADMIN attempting to submit a daily report', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shopA._id] });
    const admin = await loginAgent(app, 'admin@test.dev');

    const res = await admin.post('/api/daily-reports').send(reportPayload(shopA, product));
    expect(res.status).toBe(403);
  });

  it('rejects a future business date', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, getLagosBusinessDate());
    const sales = await loginAgent(app, 'sales@test.dev');

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 2); // safely in the future regardless of tz edge
    const futureDate = getLagosBusinessDate(tomorrow);

    const res = await sales
      .post('/api/daily-reports')
      .send(reportPayload(shopA, product, { businessDate: futureDate }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed shop/product ids', async () => {
    await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.post('/api/daily-reports').send(
      reportPayload({ _id: 'not-an-id' }, { _id: 'also-not-an-id' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects submission against an inactive shop or product', async () => {
    const inactiveShop = await createTestShop({ isActive: false });
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    await createOpeningStockDirect(inactiveShop, product, owner, 1000, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    const res = await ownerAgent.post('/api/daily-reports').send(reportPayload(inactiveShop, product));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/daily-reports — sales calculations', () => {
  it('calculates quantity and revenue correctly for a single sales line', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [{ quantity: 250, unitPriceKobo: 1200000 }],
      })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.report.totalQuantitySold).toBe(250);
    expect(res.body.data.report.expectedRevenueKobo).toBe(300000000);
    expect(res.body.data.report.salesLines[0].lineRevenueKobo).toBe(300000000);
  });

  it('calculates expected revenue correctly across multiple price lines in one day', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [
          { quantity: 250, unitPriceKobo: 1200000 },
          { quantity: 150, unitPriceKobo: 1250000 },
        ],
        physicalClosingStockQuantity: 597,
        actualAmountCollectedKobo: 485000000,
      })
    );

    expect(res.status).toBe(201);
    const { report } = res.body.data;
    expect(report.totalQuantitySold).toBe(400);
    expect(report.expectedRevenueKobo).toBe(487500000);
    expect(report.actualAmountCollectedKobo).toBe(485000000);
    expect(report.moneyVarianceKobo).toBe(-2500000);
  });

  it('server-calculates totalQuantitySold regardless of what the client implies', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [
          { quantity: 100, unitPriceKobo: 1000000 },
          { quantity: 50, unitPriceKobo: 1000000 },
        ],
      })
    );
    expect(res.body.data.report.totalQuantitySold).toBe(150);
  });

  it('server-calculates each line revenue rather than trusting a submitted value', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [{ quantity: 100, unitPriceKobo: 500000, lineRevenueKobo: 999999999 }],
      })
    );
    // lineRevenueKobo is not part of the input schema, so it is stripped —
    // the server computes 100 * 500000 = 50000000 regardless.
    expect(res.body.data.report.salesLines[0].lineRevenueKobo).toBe(50000000);
  });

  it('a client cannot spoof expectedRevenueKobo', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { expectedRevenueKobo: 1 })
    );
    expect(res.body.data.report.expectedRevenueKobo).toBe(300000000);
  });

  it('a client cannot spoof stockVarianceQuantity or other computed fields', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        stockVarianceQuantity: 999,
        openingStockQuantity: 999,
        totalQuantitySold: 999,
        status: 'APPROVED',
        submittedBy: new mongoose.Types.ObjectId().toString(),
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.data.report.stockVarianceQuantity).toBe(0); // 750 physical - 750 expected
    expect(res.body.data.report.openingStockQuantity).toBe(1000);
    expect(res.body.data.report.totalQuantitySold).toBe(250);
    expect(res.body.data.report.status).toBe('SUBMITTED');
  });

  it('rejects a fractional bag quantity', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { salesLines: [{ quantity: 250.5, unitPriceKobo: 1200000 }] })
    );
    expect(res.status).toBe(400);
  });

  it('rejects unsafe/non-integer money values', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const fractional = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { salesLines: [{ quantity: 250, unitPriceKobo: 1200000.5 }] })
    );
    expect(fractional.status).toBe(400);

    const unsafe = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        actualAmountCollectedKobo: Number.MAX_SAFE_INTEGER + 100,
      })
    );
    expect(unsafe.status).toBe(400);
  });
});

describe('POST /api/daily-reports — stock reconciliation', () => {
  it('matches the worked example: opening 1000 + received 500 - sold 400 = expected 1100, physical 1097 => variance -3', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const sales = await loginAgent(app, 'sales@test.dev');
    await receiveAndApproveStock(ownerAgent, sales, shopA, product, 500, '2020-01-10');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [
          { quantity: 250, unitPriceKobo: 1200000 },
          { quantity: 150, unitPriceKobo: 1250000 },
        ],
        physicalClosingStockQuantity: 1097,
        actualAmountCollectedKobo: 485000000,
      })
    );

    expect(res.status).toBe(201);
    const { report } = res.body.data;
    expect(report.openingStockQuantity).toBe(1000);
    expect(report.approvedStockReceivedQuantity).toBe(500);
    expect(report.availableStockQuantity).toBe(1500);
    expect(report.totalQuantitySold).toBe(400);
    expect(report.expectedClosingStockQuantity).toBe(1100);
    expect(report.physicalClosingStockQuantity).toBe(1097);
    expect(report.stockVarianceQuantity).toBe(-3);
    expect(report.expectedRevenueKobo).toBe(487500000);
    expect(report.actualAmountCollectedKobo).toBe(485000000);
    expect(report.moneyVarianceKobo).toBe(-2500000);
  });

  it('counts a same-day OPENING_STOCK as available on the very first business day', async () => {
    const { shopA, product } = await setup();
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const today = getLagosBusinessDate();

    const initRes = await ownerAgent.post('/api/inventory/opening-stock').send({
      shopId: shopA._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });
    expect(initRes.status).toBe(201);

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        businessDate: today,
        salesLines: [{ quantity: 100, unitPriceKobo: 1000000 }],
        physicalClosingStockQuantity: 900,
        actualAmountCollectedKobo: 100000000,
      })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.report.openingStockQuantity).toBe(1000);
    expect(res.body.data.report.stockVarianceQuantity).toBe(0);
  });

  it('counts approved same-day receipts but not pending or rejected ones', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const sales = await loginAgent(app, 'sales@test.dev');

    await receiveAndApproveStock(ownerAgent, sales, shopA, product, 200, '2020-01-10');

    // A second, still-pending receipt on the same day would block closure
    // entirely (see the dedicated test below) — so to isolate "approved
    // only counts", reject a second receipt instead of leaving it pending.
    const rejectSubmit = await sales.post('/api/stock-receipts').send({
      shopId: shopA._id.toString(),
      productId: product._id.toString(),
      quantity: 999,
      businessDate: '2020-01-10',
    });
    await ownerAgent
      .post(`/api/stock-receipts/${rejectSubmit.body.data.receipt._id}/reject`)
      .send({ reason: 'wrong quantity' });

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [{ quantity: 100, unitPriceKobo: 1000000 }],
        physicalClosingStockQuantity: 1100,
        actualAmountCollectedKobo: 100000000,
      })
    );

    expect(res.status).toBe(201);
    // opening 1000 + approved 200 (not the rejected 999) = 1200 available
    expect(res.body.data.report.approvedStockReceivedQuantity).toBe(200);
    expect(res.body.data.report.availableStockQuantity).toBe(1200);
  });

  it('blocks daily report submission while a same-day stock receipt is PENDING', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    await sales.post('/api/stock-receipts').send({
      shopId: shopA._id.toString(),
      productId: product._id.toString(),
      quantity: 500,
      businessDate: '2020-01-10',
    });

    const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
    expect(res.status).toBe(409);
  });

  it('physical count equal to expected yields zero variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { physicalClosingStockQuantity: 750 })
    );
    expect(res.body.data.report.stockVarianceQuantity).toBe(0);
  });

  it('physical count lower than expected yields a negative (shortage) variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { physicalClosingStockQuantity: 745 })
    );
    expect(res.body.data.report.stockVarianceQuantity).toBe(-5);
  });

  it('physical count higher than expected yields a positive (surplus) variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { physicalClosingStockQuantity: 760 })
    );
    expect(res.body.data.report.stockVarianceQuantity).toBe(10);
  });

  it('never alters the official ledger balance regardless of physical count', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { physicalClosingStockQuantity: 745 })
    );

    // Ledger balance = 1000 opening - 250 sold = 750, NOT the 745 physical
    // count, regardless of the -5 variance recorded on the report.
    const balance = await getInventoryBalance(shopA._id, product._id);
    expect(balance).toBe(750);
  });

  it('rejects a report whose reported sales exceed approved available stock', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 300, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [{ quantity: 350, unitPriceKobo: 1200000 }],
        physicalClosingStockQuantity: 0,
      })
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /api/daily-reports — money reconciliation', () => {
  it('exact collection yields zero money variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { actualAmountCollectedKobo: 300000000 })
    );
    expect(res.body.data.report.moneyVarianceKobo).toBe(0);
  });

  it('collection below expected yields a negative money variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { actualAmountCollectedKobo: 295000000 })
    );
    expect(res.body.data.report.moneyVarianceKobo).toBe(-5000000);
  });

  it('collection above expected yields a positive money variance', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { actualAmountCollectedKobo: 310000000 })
    );
    expect(res.body.data.report.moneyVarianceKobo).toBe(10000000);
  });

  it('calculates very large valid integer money values without floating-point drift', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 100000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [{ quantity: 90000, unitPriceKobo: 999999 }],
        physicalClosingStockQuantity: 10000,
        actualAmountCollectedKobo: 89999910000,
      })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.report.expectedRevenueKobo).toBe(90000 * 999999);
    expect(res.body.data.report.moneyVarianceKobo).toBe(0);
  });
});

describe('POST /api/daily-reports — ledger effect', () => {
  it('creates exactly one APPROVED SALE OUT transaction on success', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    expect(res.body.data.transaction.type).toBe('SALE');
    expect(res.body.data.transaction.direction).toBe('OUT');
    expect(res.body.data.transaction.status).toBe('APPROVED');
    expect(res.body.data.transaction.referenceType).toBe('DAILY_SALES_REPORT');
    expect(res.body.data.transaction.referenceId).toBe(res.body.data.report._id);

    const count = await InventoryTransaction.countDocuments({
      shopId: shopA._id,
      productId: product._id,
      type: 'SALE',
    });
    expect(count).toBe(1);
  });

  it('sale transaction quantity equals totalQuantitySold', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, {
        salesLines: [
          { quantity: 100, unitPriceKobo: 1000000 },
          { quantity: 50, unitPriceKobo: 1000000 },
        ],
      })
    );
    expect(res.body.data.transaction.quantity).toBe(150);
  });

  it('official balance decreases by bags sold', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const balance = await getInventoryBalance(shopA._id, product._id);
    expect(balance).toBe(750); // 1000 - 250
  });

  it('a duplicate business-day report never creates a second SALE effect', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
    const second = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    expect(second.status).toBe(409);
    const count = await InventoryTransaction.countDocuments({
      shopId: shopA._id,
      productId: product._id,
      type: 'SALE',
    });
    expect(count).toBe(1);
  });
});

describe('POST /api/daily-reports — concurrency', () => {
  it('under real concurrency, exactly one of two simultaneous reports succeeds with exactly one SALE effect', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const [first, second] = await Promise.all([
      sales.post('/api/daily-reports').send(reportPayload(shopA, product)),
      sales.post('/api/daily-reports').send(reportPayload(shopA, product)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const reportCount = await DailySalesReport.countDocuments({ shopId: shopA._id, productId: product._id });
    expect(reportCount).toBe(1);

    const saleCount = await InventoryTransaction.countDocuments({
      shopId: shopA._id,
      productId: product._id,
      type: 'SALE',
    });
    expect(saleCount).toBe(1);
  });
});

describe('POST /api/daily-reports — chronological order', () => {
  it('rejects an earlier report submitted after a later business date has already been closed', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-08');
    const sales = await loginAgent(app, 'sales@test.dev');

    const later = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { businessDate: '2020-01-10', physicalClosingStockQuantity: 750 })
    );
    expect(later.status).toBe(201);

    const earlier = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { businessDate: '2020-01-09', physicalClosingStockQuantity: 750 })
    );
    expect(earlier.status).toBe(409);
  });
});

describe('Daily sales report immutability', () => {
  it('has no PUT/PATCH edit endpoint', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
    const id = submitRes.body.data.report._id;

    const putRes = await sales.put(`/api/daily-reports/${id}`).send({ notes: 'edited' });
    const patchRes = await sales.patch(`/api/daily-reports/${id}`).send({ notes: 'edited' });
    expect(putRes.status).toBe(404);
    expect(patchRes.status).toBe(404);
  });

  it('has no DELETE endpoint', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
    const id = submitRes.body.data.report._id;

    const res = await sales.delete(`/api/daily-reports/${id}`);
    expect(res.status).toBe(404);
  });
});

describe('Daily sales report compensation on partial failure', () => {
  it('leaves no orphaned DailySalesReport if the SALE transaction creation fails', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const spy = vi
      .spyOn(InventoryTransaction, 'create')
      .mockRejectedValueOnce(new Error('simulated failure creating the SALE transaction'));

    try {
      const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
      expect(res.status).toBe(500);

      const orphan = await DailySalesReport.findOne({ shopId: shopA._id, productId: product._id });
      expect(orphan).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves no orphaned SALE transaction if linking the report fails', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const spy = vi
      .spyOn(DailySalesReport.prototype, 'save')
      .mockRejectedValueOnce(new Error('simulated failure linking the report'));

    try {
      const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));
      expect(res.status).toBe(500);

      const orphanReport = await DailySalesReport.findOne({ shopId: shopA._id, productId: product._id });
      expect(orphanReport).toBeNull();

      const orphanTxn = await InventoryTransaction.findOne({
        shopId: shopA._id,
        productId: product._id,
        type: 'SALE',
      });
      expect(orphanTxn).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Daily sales report audit logging', () => {
  it('creates a DAILY_SALES_REPORT_SUBMITTED audit entry on successful submission', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const entry = await AuditLog.findOne({ action: 'DAILY_SALES_REPORT_SUBMITTED' });
    expect(entry).not.toBeNull();
    expect(entry.entityId.toString()).toBe(res.body.data.report._id);
    expect(entry.shopId.toString()).toBe(shopA._id.toString());
  });
});

describe('GET /api/daily-reports — read access', () => {
  it('lets OWNER read all reports across shops', async () => {
    const { shopA, shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post('/api/daily-reports').send(reportPayload(shopB, product));

    const res = await ownerAgent.get('/api/daily-reports');
    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(2);
  });

  it('limits a salesperson to reports for their assigned shop only', async () => {
    const { shopA, shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post('/api/daily-reports').send(reportPayload(shopB, product));

    const res = await sales.get('/api/daily-reports');
    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(1);
    expect(res.body.data.reports[0].shopId._id).toBe(shopA._id.toString());
  });

  it('limits ADMIN to assigned-shop reports only', async () => {
    const { shopA, shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post('/api/daily-reports').send(reportPayload(shopB, product));

    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shopA._id] });
    const admin = await loginAgent(app, 'admin@test.dev');

    const res = await admin.get('/api/daily-reports');
    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(1);
    expect(res.body.data.reports[0].shopId._id).toBe(shopA._id.toString());
  });

  it('rejects reading a report belonging to an unauthorized shop by id', async () => {
    const { shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const submitRes = await ownerAgent.post('/api/daily-reports').send(reportPayload(shopB, product));

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.get(`/api/daily-reports/${submitRes.body.data.report._id}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/daily-reports/summary', () => {
  it('is OWNER-only', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.get('/api/daily-reports/summary?businessDate=2020-01-10');
    expect(res.status).toBe(403);
  });

  it('returns every report for the requested business date across shops', async () => {
    const { shopA, shopB, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    await createOpeningStockDirect(shopB, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');
    await sales.post('/api/daily-reports').send(reportPayload(shopA, product));

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    await ownerAgent.post('/api/daily-reports').send(reportPayload(shopB, product));

    const res = await ownerAgent.get('/api/daily-reports/summary?businessDate=2020-01-10');
    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(2);
  });
});

describe('Price history independence', () => {
  it('changing the active ShopPrice does not alter an already-saved report', async () => {
    const { shopA, product, owner } = await setup();
    await createOpeningStockDirect(shopA, product, owner, 1000, '2020-01-10');
    const sales = await loginAgent(app, 'sales@test.dev');

    const submitRes = await sales.post('/api/daily-reports').send(
      reportPayload(shopA, product, { salesLines: [{ quantity: 250, unitPriceKobo: 1200000 }] })
    );
    const reportId = submitRes.body.data.report._id;

    // A ShopPrice change "tomorrow" — this must never retroactively touch
    // yesterday's saved report.
    const { ShopPrice } = await import('../src/models/ShopPrice.js');
    await ShopPrice.create({
      shopId: shopA._id,
      productId: product._id,
      priceKobo: 9999999,
      changedBy: owner._id,
    });

    const ownerAgent = await loginAgent(app, 'owner@test.dev');
    const res = await ownerAgent.get(`/api/daily-reports/${reportId}`);

    expect(res.body.data.report.salesLines[0].unitPriceKobo).toBe(1200000);
    expect(res.body.data.report.expectedRevenueKobo).toBe(300000000);
  });
});
