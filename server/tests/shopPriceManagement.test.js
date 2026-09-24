import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { ShopPrice } from '../src/models/ShopPrice.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();

beforeAll(async () => {
  await startTestDb();
  await ShopPrice.init();
});
afterAll(stopTestDb);
beforeEach(clearTestDb);

describe('POST /api/shop-prices — set price', () => {
  it('17. OWNER can set a price for an active shop/product', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    expect(res.status).toBe(201);
    expect(res.body.data.price.priceKobo).toBe(1200000);
    expect(res.body.data.price.effectiveTo).toBeNull();
  });

  it('18. a non-owner cannot set a price', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, manager.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    expect(res.status).toBe(403);
  });

  it('19. an invalid (nonexistent) shop is rejected', async () => {
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);
    const fakeShopId = new mongoose.Types.ObjectId().toString();

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: fakeShopId, productId: product._id.toString(), priceKobo: 1200000 });

    expect(res.status).toBe(404);
  });

  it('20. an invalid (nonexistent) product is rejected', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);
    const fakeProductId = new mongoose.Types.ObjectId().toString();

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: fakeProductId, priceKobo: 1200000 });

    expect(res.status).toBe(404);
  });

  it('21. an inactive shop is rejected', async () => {
    const shop = await createTestShop({ isActive: false });
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    expect(res.status).toBe(400);
  });

  it('22. an inactive product is rejected', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct({ isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    expect(res.status).toBe(400);
  });

  it('23. a non-positive price is rejected', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 0 });

    expect(res.status).toBe(400);
  });

  it('24. a non-integer kobo amount is rejected', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200.5 });

    expect(res.status).toBe(400);
  });

  it('25. the first price set becomes the active price', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    const current = await ShopPrice.findOne({ shopId: shop._id, productId: product._id, effectiveTo: null });
    expect(current).not.toBeNull();
    expect(current.priceKobo).toBe(1200000);
  });

  it('26. changing the price preserves the old row historically', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });
    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1300000 });

    const history = await ShopPrice.find({ shopId: shop._id, productId: product._id }).sort({ effectiveFrom: 1 });
    expect(history).toHaveLength(2);
    expect(history[0].priceKobo).toBe(1200000);
    expect(history[0].effectiveTo).not.toBeNull();
    expect(history[1].priceKobo).toBe(1300000);
    expect(history[1].effectiveTo).toBeNull();
  });

  it('27. only one current active price exists per shop/product', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });
    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1300000 });

    const activeRows = await ShopPrice.find({ shopId: shop._id, productId: product._id, effectiveTo: null });
    expect(activeRows).toHaveLength(1);
  });

  it('28. the current-price query returns the latest active price', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });
    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1300000 });

    const res = await agent.get(`/api/shop-prices/shop/${shop._id}/product/${product._id}/current`);
    expect(res.status).toBe(200);
    expect(res.body.data.price.priceKobo).toBe(1300000);
  });

  it('29. historical price rows remain unchanged after a later change', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const firstRes = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });
    const firstId = firstRes.body.data.price._id;

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1300000 });

    const firstRow = await ShopPrice.findById(firstId);
    expect(firstRow.priceKobo).toBe(1200000);
  });

  it('30. an audit event is created when a price is set', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    const log = await AuditLog.findOne({ action: 'SHOP_PRICE_CHANGED', entityId: res.body.data.price._id });
    expect(log).not.toBeNull();
    expect(log.userId.toString()).toBe(owner._id.toString());
  });
});

describe('Bulk price reads (no N+1)', () => {
  it('GET /api/shop-prices/product/:productId/current lists every active shop with its current price', async () => {
    const shopA = await createTestShop({ name: 'Shop A' });
    const shopB = await createTestShop({ name: 'Shop B' });
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shopA._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    const res = await agent.get(`/api/shop-prices/product/${product._id}/current`);
    expect(res.status).toBe(200);
    expect(res.body.data.prices).toHaveLength(2);
    const forShopA = res.body.data.prices.find((p) => p.shop.id === shopA._id.toString());
    const forShopB = res.body.data.prices.find((p) => p.shop.id === shopB._id.toString());
    expect(forShopA.priceKobo).toBe(1200000);
    expect(forShopB.priceKobo).toBeNull();
  });

  it('GET /api/shop-prices/shop/:shopId/current lists every active product with its current price', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent
      .post('/api/shop-prices')
      .send({ shopId: shop._id.toString(), productId: product._id.toString(), priceKobo: 1200000 });

    const res = await agent.get(`/api/shop-prices/shop/${shop._id}/current`);
    expect(res.status).toBe(200);
    expect(res.body.data.prices).toHaveLength(1);
    expect(res.body.data.prices[0].priceKobo).toBe(1200000);
  });

  it('non-owner cannot access the bulk price-read endpoints', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, manager.email);

    const res1 = await agent.get(`/api/shop-prices/product/${product._id}/current`);
    const res2 = await agent.get(`/api/shop-prices/shop/${shop._id}/current`);
    expect(res1.status).toBe(403);
    expect(res2.status).toBe(403);
  });
});
