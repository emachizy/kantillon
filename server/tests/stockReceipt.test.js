import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { ROLES } from '../src/utils/constants.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { StockReceipt } from '../src/models/StockReceipt.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { DailySalesReport } from '../src/models/DailySalesReport.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function setup() {
  const shopA = await createTestShop({ name: 'Shop A' });
  const shopB = await createTestShop({ name: 'Shop B' });
  const product = await createTestProduct();
  const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
  const salesperson = await createTestUser({
    role: ROLES.SALESPERSON,
    email: 'sales@test.dev',
    shopIds: [shopA._id],
  });
  return { shopA, shopB, product, owner, salesperson };
}

async function submitReceipt(agent, shop, product, overrides = {}) {
  return agent.post('/api/stock-receipts').send({
    shopId: shop._id.toString(),
    productId: product._id.toString(),
    quantity: 500,
    deliveryReference: 'DEL-2026-001',
    notes: 'Morning delivery',
    ...overrides,
  });
}

describe('POST /api/stock-receipts (submission)', () => {
  it('lets a salesperson submit a receipt for their assigned shop, starting PENDING', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await submitReceipt(sales, shopA, product);

    expect(res.status).toBe(201);
    expect(res.body.data.receipt.status).toBe('PENDING');
    expect(res.body.data.transaction.status).toBe('PENDING');
    expect(res.body.data.transaction.type).toBe('STOCK_RECEIPT');
    expect(res.body.data.transaction.referenceType).toBe('STOCK_RECEIPT');
    expect(res.body.data.transaction.referenceId).toBe(res.body.data.receipt._id);
  });

  it('rejects a salesperson submitting for a shop they are not assigned to', async () => {
    const { shopB, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await submitReceipt(sales, shopB, product);
    expect(res.status).toBe(403);
  });

  it('rejects an ADMIN attempting to submit a stock receipt — not in the allowed role list', async () => {
    const { shopA, product } = await setup();
    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shopA._id] });
    const admin = await loginAgent(app, 'admin@test.dev');

    const res = await submitReceipt(admin, shopA, product);
    expect(res.status).toBe(403);
  });

  it('a client cannot force status: APPROVED at submission time', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await submitReceipt(sales, shopA, product, { status: 'APPROVED' });
    expect(res.status).toBe(201);
    expect(res.body.data.receipt.status).toBe('PENDING');
  });

  it('does not affect official inventory while pending', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    await submitReceipt(sales, shopA, product);

    const owner = await loginAgent(app, 'owner@test.dev');
    const inventoryRes = await owner.get(`/api/inventory/shop/${shopA._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(0);
  });

  it('rejects quantity <= 0', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await submitReceipt(sales, shopA, product, { quantity: 0 });
    expect(res.status).toBe(400);
  });

  it('creates a STOCK_RECEIPT_SUBMITTED audit entry', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await submitReceipt(sales, shopA, product);

    const entry = await AuditLog.findOne({ action: 'STOCK_RECEIPT_SUBMITTED' });
    expect(entry).not.toBeNull();
    expect(entry.entityId.toString()).toBe(res.body.data.receipt._id);
  });
});

describe('POST /api/stock-receipts/:id/approve and /reject', () => {
  it('lets OWNER approve a pending receipt, which then affects inventory', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product, { quantity: 500 });
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    const approveRes = await owner.post(`/api/stock-receipts/${receiptId}/approve`);

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.receipt.status).toBe('APPROVED');
    expect(approveRes.body.data.balance).toBe(500);

    const inventoryRes = await owner.get(`/api/inventory/shop/${shopA._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(500);
  });

  it('rejects a salesperson attempting to approve a receipt', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);

    const approveRes = await sales.post(`/api/stock-receipts/${submitRes.body.data.receipt._id}/approve`);
    expect(approveRes.status).toBe(403);
  });

  it('rejects an ADMIN attempting to approve, reject, or view the pending queue — OWNER only in Phase 2', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shopA._id] });
    const admin = await loginAgent(app, 'admin@test.dev');

    const approveRes = await admin.post(`/api/stock-receipts/${receiptId}/approve`);
    expect(approveRes.status).toBe(403);

    const rejectRes = await admin.post(`/api/stock-receipts/${receiptId}/reject`).send({ reason: 'no' });
    expect(rejectRes.status).toBe(403);

    const pendingRes = await admin.get('/api/stock-receipts/pending');
    expect(pendingRes.status).toBe(403);
  });

  it('lets OWNER reject a receipt with a reason, which never affects inventory', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    const rejectRes = await owner
      .post(`/api/stock-receipts/${receiptId}/reject`)
      .send({ reason: 'Quantity does not match delivery' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.receipt.status).toBe('REJECTED');
    expect(rejectRes.body.data.receipt.rejectionReason).toBe('Quantity does not match delivery');

    const inventoryRes = await owner.get(`/api/inventory/shop/${shopA._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(0);
  });

  it('requires a reason to reject', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);

    const owner = await loginAgent(app, 'owner@test.dev');
    const res = await owner.post(`/api/stock-receipts/${submitRes.body.data.receipt._id}/reject`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 when approving an already-approved receipt', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    await owner.post(`/api/stock-receipts/${receiptId}/approve`);
    const second = await owner.post(`/api/stock-receipts/${receiptId}/approve`);

    expect(second.status).toBe(409);
  });

  it('returns 409 when approving an already-rejected receipt', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    await owner.post(`/api/stock-receipts/${receiptId}/reject`).send({ reason: 'bad delivery' });
    const approveAfterReject = await owner.post(`/api/stock-receipts/${receiptId}/approve`);

    expect(approveAfterReject.status).toBe(409);
  });

  it('returns 409 when rejecting an already-approved receipt', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    await owner.post(`/api/stock-receipts/${receiptId}/approve`);
    const rejectAfterApprove = await owner
      .post(`/api/stock-receipts/${receiptId}/reject`)
      .send({ reason: 'too late' });

    expect(rejectAfterApprove.status).toBe(409);

    const inventoryRes = await owner.get(`/api/inventory/shop/${shopA._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(500);
  });

  it('returns 409 when rejecting an already-rejected receipt', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product);
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    await owner.post(`/api/stock-receipts/${receiptId}/reject`).send({ reason: 'first reason' });
    const second = await owner
      .post(`/api/stock-receipts/${receiptId}/reject`)
      .send({ reason: 'second reason' });

    expect(second.status).toBe(409);
  });

  it('returns 404 when approving a nonexistent receipt', async () => {
    await setup();
    const owner = await loginAgent(app, 'owner@test.dev');
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await owner.post(`/api/stock-receipts/${fakeId}/approve`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed receipt id', async () => {
    await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const res = await owner.post('/api/stock-receipts/not-an-id/approve');
    expect(res.status).toBe(400);
  });

  it('under real concurrency, exactly one of two simultaneous approve requests wins and stock is only applied once', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const submitRes = await submitReceipt(sales, shopA, product, { quantity: 500 });
    const receiptId = submitRes.body.data.receipt._id;

    const owner = await loginAgent(app, 'owner@test.dev');
    const [first, second] = await Promise.all([
      owner.post(`/api/stock-receipts/${receiptId}/approve`),
      owner.post(`/api/stock-receipts/${receiptId}/approve`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const inventoryRes = await owner.get(`/api/inventory/shop/${shopA._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    // Stock must reflect the 500-unit receipt exactly once, never twice.
    expect(line.balance).toBe(500);
  });

  it('creates STOCK_RECEIPT_APPROVED and STOCK_RECEIPT_REJECTED audit entries', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');
    const owner = await loginAgent(app, 'owner@test.dev');

    const approveSubmission = await submitReceipt(sales, shopA, product);
    await owner.post(`/api/stock-receipts/${approveSubmission.body.data.receipt._id}/approve`);
    const approvedEntry = await AuditLog.findOne({ action: 'STOCK_RECEIPT_APPROVED' });
    expect(approvedEntry).not.toBeNull();

    const rejectSubmission = await submitReceipt(sales, shopA, product);
    await owner
      .post(`/api/stock-receipts/${rejectSubmission.body.data.receipt._id}/reject`)
      .send({ reason: 'wrong quantity' });
    const rejectedEntry = await AuditLog.findOne({ action: 'STOCK_RECEIPT_REJECTED' });
    expect(rejectedEntry).not.toBeNull();
    expect(rejectedEntry.reason).toBe('wrong quantity');
  });
});

describe('standalone-MongoDB partial-failure compensation on submission', () => {
  it('leaves no orphaned StockReceipt if InventoryTransaction creation fails', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const spy = vi
      .spyOn(InventoryTransaction, 'create')
      .mockRejectedValueOnce(new Error('simulated failure creating the ledger row'));

    try {
      const res = await submitReceipt(sales, shopA, product, { quantity: 777 });
      expect(res.status).toBe(500);

      const orphan = await StockReceipt.findOne({ shopId: shopA._id, productId: product._id });
      expect(orphan).toBeNull();

      const anyTransaction = await InventoryTransaction.findOne({
        shopId: shopA._id,
        productId: product._id,
      });
      expect(anyTransaction).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves no orphaned InventoryTransaction if the receipt→transaction link save fails', async () => {
    const { shopA, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    // Model.create() with an array of docs uses a bulk insert internally
    // (not per-document .save()), so StockReceipt.prototype.save is only
    // called once in this flow: the explicit link-back save after both the
    // receipt and its InventoryTransaction already exist. Failing exactly
    // that call reproduces "both created, but the link step fails".
    const spy = vi
      .spyOn(StockReceipt.prototype, 'save')
      .mockRejectedValueOnce(new Error('simulated failure linking the receipt'));

    try {
      const res = await submitReceipt(sales, shopA, product, { quantity: 888 });
      expect(res.status).toBe(500);

      const orphanReceipt = await StockReceipt.findOne({ shopId: shopA._id, productId: product._id });
      expect(orphanReceipt).toBeNull();

      const orphanTransaction = await InventoryTransaction.findOne({
        shopId: shopA._id,
        productId: product._id,
      });
      expect(orphanTransaction).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

async function closeBusinessDate(shop, product, owner, businessDate) {
  return DailySalesReport.create({
    shopId: shop._id,
    productId: product._id,
    businessDate,
    salesLines: [{ quantity: 10, unitPriceKobo: 100000, lineRevenueKobo: 1000000 }],
    openingStockQuantity: 100,
    approvedStockReceivedQuantity: 0,
    availableStockQuantity: 100,
    totalQuantitySold: 10,
    expectedClosingStockQuantity: 90,
    physicalClosingStockQuantity: 90,
    stockVarianceQuantity: 0,
    expectedRevenueKobo: 1000000,
    actualAmountCollectedKobo: 1000000,
    moneyVarianceKobo: 0,
    submittedBy: owner._id,
  });
}

describe('stock receipt business-date closure rules', () => {
  it('rejects a new stock receipt dated a business day already closed by a daily report', async () => {
    const { shopA, product, owner } = await setup();
    await closeBusinessDate(shopA, product, owner, '2020-01-10');

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await submitReceipt(sales, shopA, product, { businessDate: '2020-01-10' });

    expect(res.status).toBe(409);
  });

  it('rejects a backdated stock receipt before an already-closed later business day', async () => {
    const { shopA, product, owner } = await setup();
    await closeBusinessDate(shopA, product, owner, '2020-01-10');

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await submitReceipt(sales, shopA, product, { businessDate: '2020-01-08' });

    expect(res.status).toBe(409);
  });

  it('allows a stock receipt dated after the latest closed business day', async () => {
    const { shopA, product, owner } = await setup();
    await closeBusinessDate(shopA, product, owner, '2020-01-10');

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await submitReceipt(sales, shopA, product, { businessDate: '2020-01-11' });

    expect(res.status).toBe(201);
  });
});
