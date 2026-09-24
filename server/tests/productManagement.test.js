import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestProduct, createTestShop, loginAgent } from './factories.js';
import { Product } from '../src/models/Product.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

describe('POST /api/products — creation', () => {
  it('1. OWNER can create a product', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/products').send({ name: 'Lafarge Cement' });

    expect(res.status).toBe(201);
    expect(res.body.data.product.name).toBe('Lafarge Cement');
    expect(res.body.data.product.sku).toBeTruthy();
    expect(res.body.data.product.unit).toBe('bag');
  });

  it('2. MANAGER cannot create a product', async () => {
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev' });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.post('/api/products').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('3. SALESPERSON cannot create a product', async () => {
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev' });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.post('/api/products').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('4. ADMIN cannot create a product', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev' });
    const agent = await loginAgent(app, admin.email);

    const res = await agent.post('/api/products').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('5. unauthenticated cannot create a product', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/products').send({ name: 'Should Fail' });
    expect(res.status).toBe(401);
  });

  it('6. blank product name is rejected', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/products').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('7. a created product defaults to active', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/products').send({ name: 'New Product' });
    expect(res.body.data.product.isActive).toBe(true);
  });
});

describe('PATCH /api/products/:productId — edit', () => {
  it('8. OWNER can edit a product', async () => {
    const product = await createTestProduct({ name: 'Old Name' });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.patch(`/api/products/${product._id}`).send({ name: 'New Name', unit: 'sack' });
    expect(res.status).toBe(200);
    expect(res.body.data.product.name).toBe('New Name');
    expect(res.body.data.product.unit).toBe('sack');
  });

  it('9. staff cannot edit a product', async () => {
    const product = await createTestProduct();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev' });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.patch(`/api/products/${product._id}`).send({ name: 'Hacked Name' });
    expect(res.status).toBe(403);
  });

  it('rejects unknown fields (no mass assignment)', async () => {
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.patch(`/api/products/${product._id}`).send({ isActive: false, sku: 'HACKED' });
    expect(res.status).toBe(400);
  });
});

describe('Deactivate / reactivate product', () => {
  it('10. OWNER can deactivate a product', async () => {
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post(`/api/products/${product._id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(false);
  });

  it('11. OWNER can reactivate a product', async () => {
    const product = await createTestProduct({ isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post(`/api/products/${product._id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.product.isActive).toBe(true);
  });

  it('staff cannot deactivate a product', async () => {
    const product = await createTestProduct();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev' });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.post(`/api/products/${product._id}/deactivate`);
    expect(res.status).toBe(403);
  });

  it('12. product history references remain after deactivate', async () => {
    const product = await createTestProduct();
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    await InventoryTransaction.create({
      shopId: shop._id,
      productId: product._id,
      type: 'OPENING_STOCK',
      quantity: 10,
      direction: 'IN',
      status: 'APPROVED',
      createdBy: owner._id,
      businessDate: '2026-01-01',
    });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/products/${product._id}/deactivate`);

    const stillExists = await Product.findById(product._id);
    expect(stillExists).not.toBeNull();
    const txn = await InventoryTransaction.findOne({ productId: product._id });
    expect(txn).not.toBeNull();
  });
});

describe('Audit logging', () => {
  it('13. audit created for product creation', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/products').send({ name: 'Audited Product' });

    const log = await AuditLog.findOne({ action: 'PRODUCT_CREATED', entityId: res.body.data.product._id });
    expect(log).not.toBeNull();
    expect(log.userId.toString()).toBe(owner._id.toString());
  });

  it('14. audit created for edit', async () => {
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.patch(`/api/products/${product._id}`).send({ name: 'Edited Name' });

    const log = await AuditLog.findOne({ action: 'PRODUCT_UPDATED', entityId: product._id });
    expect(log).not.toBeNull();
  });

  it('15. audit created for deactivate', async () => {
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/products/${product._id}/deactivate`);

    const log = await AuditLog.findOne({ action: 'PRODUCT_DEACTIVATED', entityId: product._id });
    expect(log).not.toBeNull();
  });

  it('16. audit created for reactivate', async () => {
    const product = await createTestProduct({ isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/products/${product._id}/reactivate`);

    const log = await AuditLog.findOne({ action: 'PRODUCT_REACTIVATED', entityId: product._id });
    expect(log).not.toBeNull();
  });
});

describe('GET /api/products — listing', () => {
  it('active-only by default, even for OWNER', async () => {
    await createTestProduct({ name: 'Active Product', isActive: true });
    await createTestProduct({ name: 'Inactive Product', isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/products');
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].name).toBe('Active Product');
  });

  it('OWNER can see inactive products with includeInactive=true', async () => {
    await createTestProduct({ name: 'Active Product', isActive: true });
    await createTestProduct({ name: 'Inactive Product', isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/products?includeInactive=true');
    expect(res.body.data.products).toHaveLength(2);
  });

  it('a non-owner cannot use includeInactive to see inactive products', async () => {
    await createTestProduct({ name: 'Active Product', isActive: true });
    await createTestProduct({ name: 'Inactive Product', isActive: false });
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev' });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get('/api/products?includeInactive=true');
    expect(res.body.data.products).toHaveLength(1);
  });
});
