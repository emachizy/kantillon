import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { ROLES } from '../src/utils/constants.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function setup() {
  const shop = await createTestShop();
  const product = await createTestProduct();
  const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
  const salesperson = await createTestUser({
    role: ROLES.SALESPERSON,
    email: 'sales@test.dev',
    shopIds: [shop._id],
  });
  return { shop, product, owner, salesperson };
}

describe('POST /api/inventory/opening-stock', () => {
  it('allows OWNER to initialize opening stock and it immediately affects official inventory', async () => {
    const { shop, product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const res = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
      notes: 'Physical stock at system launch',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.type).toBe('OPENING_STOCK');
    expect(res.body.data.transaction.status).toBe('APPROVED');
    expect(res.body.data.transaction.direction).toBe('IN');
    expect(res.body.data.balance).toBe(1000);

    const inventoryRes = await owner.get(`/api/inventory/shop/${shop._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(1000);
    expect(line.initialized).toBe(true);
  });

  it('rejects a salesperson attempting to initialize opening stock', async () => {
    const { shop, product } = await setup();
    const sales = await loginAgent(app, 'sales@test.dev');

    const res = await sales.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });

    expect(res.status).toBe(403);
  });

  it('rejects an ADMIN attempting to initialize opening stock — OWNER only in Phase 2', async () => {
    const { shop, product } = await setup();
    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shop._id] });
    const admin = await loginAgent(app, 'admin@test.dev');

    const res = await admin.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });

    expect(res.status).toBe(403);
  });

  it('rejects quantity <= 0', async () => {
    const { shop, product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const zero = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 0,
    });
    expect(zero.status).toBe(400);

    const negative = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: -5,
    });
    expect(negative.status).toBe(400);
  });

  it('rejects a duplicate opening-stock initialization for the same shop/product with 409', async () => {
    const { shop, product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const first = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });
    expect(first.status).toBe(201);

    const second = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 500,
    });
    expect(second.status).toBe(409);

    const inventoryRes = await owner.get(`/api/inventory/shop/${shop._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    expect(line.balance).toBe(1000);
  });

  it('under real concurrency, exactly one of two simultaneous opening-stock requests succeeds', async () => {
    const { shop, product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const [first, second] = await Promise.all([
      owner.post('/api/inventory/opening-stock').send({
        shopId: shop._id.toString(),
        productId: product._id.toString(),
        quantity: 1000,
      }),
      owner.post('/api/inventory/opening-stock').send({
        shopId: shop._id.toString(),
        productId: product._id.toString(),
        quantity: 2000,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    const inventoryRes = await owner.get(`/api/inventory/shop/${shop._id}`);
    const line = inventoryRes.body.data.inventory.find(
      (i) => i.product.id === product._id.toString()
    );
    // The database-level partial unique index — not just the app-level
    // pre-check — is what guarantees this under real concurrency: balance
    // must equal exactly the winning request's quantity, never both summed.
    expect(line.balance).toBe(winner.body.data.transaction.quantity);

    const openingStockCount = await InventoryTransaction.countDocuments({
      shopId: shop._id,
      productId: product._id,
      type: 'OPENING_STOCK',
    });
    expect(openingStockCount).toBe(1);
  });

  it('creates an OPENING_STOCK_CREATED audit entry', async () => {
    const { shop, product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const res = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });

    const entry = await AuditLog.findOne({ action: 'OPENING_STOCK_CREATED' });
    expect(entry).not.toBeNull();
    expect(entry.entityId.toString()).toBe(res.body.data.transaction._id);
    expect(entry.shopId.toString()).toBe(shop._id.toString());
  });

  it('rejects a nonexistent shop or product with 404', async () => {
    const { product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');
    const fakeId = new mongoose.Types.ObjectId().toString();

    const badShop = await owner.post('/api/inventory/opening-stock').send({
      shopId: fakeId,
      productId: product._id.toString(),
      quantity: 100,
    });
    expect(badShop.status).toBe(404);

    const shop = await createTestShop();
    const badProduct = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: fakeId,
      quantity: 100,
    });
    expect(badProduct.status).toBe(404);
  });

  it('rejects a malformed ObjectId with 400', async () => {
    const { product } = await setup();
    const owner = await loginAgent(app, 'owner@test.dev');

    const res = await owner.post('/api/inventory/opening-stock').send({
      shopId: 'not-an-object-id',
      productId: product._id.toString(),
      quantity: 100,
    });
    expect(res.status).toBe(400);
  });

  it('rejects initialization against an inactive shop', async () => {
    const shop = await createTestShop({ isActive: false });
    const product = await createTestProduct();
    await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const owner = await loginAgent(app, 'owner@test.dev');

    const res = await owner.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 100,
    });
    expect(res.status).toBe(400);
  });

  it('rejects opening-stock initialization once other inventory activity already exists', async () => {
    const { shop, product, owner } = await setup();
    const ownerAgent = await loginAgent(app, 'owner@test.dev');

    // Simulate a stock receipt (or any non-opening-stock movement) having
    // already happened for this shop/product before opening stock is set.
    await InventoryTransaction.create({
      shopId: shop._id,
      productId: product._id,
      type: 'STOCK_RECEIPT',
      direction: 'IN',
      quantity: 50,
      status: 'APPROVED',
      createdBy: owner._id,
      businessDate: '2026-09-01',
    });

    const res = await ownerAgent.post('/api/inventory/opening-stock').send({
      shopId: shop._id.toString(),
      productId: product._id.toString(),
      quantity: 1000,
    });

    expect(res.status).toBe(409);
  });
});
