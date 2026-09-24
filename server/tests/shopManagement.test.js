import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { Shop } from '../src/models/Shop.js';
import { User } from '../src/models/User.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

describe('POST /api/shops — creation', () => {
  it('1. OWNER can create a shop', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/shops').send({ name: 'Kantillon Main Shop' });

    expect(res.status).toBe(201);
    expect(res.body.data.shop.name).toBe('Kantillon Main Shop');
    expect(res.body.data.shop.code).toBeTruthy();
  });

  it('2. MANAGER cannot create a shop', async () => {
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev' });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.post('/api/shops').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('3. SALESPERSON cannot create a shop', async () => {
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev' });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.post('/api/shops').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('4. ADMIN cannot create a shop', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev' });
    const agent = await loginAgent(app, admin.email);

    const res = await agent.post('/api/shops').send({ name: 'Should Fail' });
    expect(res.status).toBe(403);
  });

  it('5. unauthenticated cannot create a shop', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/shops').send({ name: 'Should Fail' });
    expect(res.status).toBe(401);
  });

  it('6. blank shop name is rejected', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/shops').send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('7. a created shop defaults to active', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/shops').send({ name: 'New Shop' });
    expect(res.body.data.shop.isActive).toBe(true);
  });
});

describe('GET /api/shops — listing scope', () => {
  it('8. OWNER can list all shops', async () => {
    await createTestShop({ name: 'Shop A' });
    await createTestShop({ name: 'Shop B' });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/shops');
    expect(res.status).toBe(200);
    expect(res.body.data.shops).toHaveLength(2);
  });

  it('9. an assigned manager only sees permitted shop(s)', async () => {
    const shopA = await createTestShop({ name: 'Shop A' });
    await createTestShop({ name: 'Shop B' });
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.get('/api/shops');
    expect(res.status).toBe(200);
    expect(res.body.data.shops).toHaveLength(1);
    expect(res.body.data.shops[0]._id).toBe(shopA._id.toString());
  });

  it('10. a salesperson only sees permitted shop(s)', async () => {
    const shopA = await createTestShop({ name: 'Shop A' });
    await createTestShop({ name: 'Shop B' });
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get('/api/shops');
    expect(res.status).toBe(200);
    expect(res.body.data.shops).toHaveLength(1);
    expect(res.body.data.shops[0]._id).toBe(shopA._id.toString());
  });

  it('does not expose an inactive shop to a role that only sees active shops by default', async () => {
    await createTestShop({ name: 'Active Shop', isActive: true });
    await createTestShop({ name: 'Inactive Shop', isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/shops');
    expect(res.body.data.shops).toHaveLength(1);
    expect(res.body.data.shops[0].name).toBe('Active Shop');
  });

  it('OWNER can see inactive shops with includeInactive=true', async () => {
    await createTestShop({ name: 'Active Shop', isActive: true });
    await createTestShop({ name: 'Inactive Shop', isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/shops?includeInactive=true');
    expect(res.body.data.shops).toHaveLength(2);
  });

  it('a non-owner cannot use includeInactive to see an inactive shop outside their scope', async () => {
    const shopA = await createTestShop({ name: 'Shop A', isActive: true });
    await createTestShop({ name: 'Inactive Shop', isActive: false });
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get('/api/shops?includeInactive=true');
    expect(res.body.data.shops).toHaveLength(1);
  });
});

describe('GET /api/shops/:shopId — detail', () => {
  it('11. OWNER can get shop detail', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get(`/api/shops/${shop._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.shop._id).toBe(shop._id.toString());
  });

  it('12. unauthorized staff cannot get an unassigned shop detail', async () => {
    const shopA = await createTestShop({ name: 'Shop A' });
    const shopB = await createTestShop({ name: 'Shop B' });
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get(`/api/shops/${shopB._id}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/shops/:shopId — edit', () => {
  it('13. OWNER can edit a shop', async () => {
    const shop = await createTestShop({ name: 'Old Name' });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.patch(`/api/shops/${shop._id}`).send({ name: 'New Name', address: '1 Market Rd' });
    expect(res.status).toBe(200);
    expect(res.body.data.shop.name).toBe('New Name');
    expect(res.body.data.shop.address).toBe('1 Market Rd');
  });

  it('14. staff cannot edit a shop', async () => {
    const shop = await createTestShop();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.patch(`/api/shops/${shop._id}`).send({ name: 'Hacked Name' });
    expect(res.status).toBe(403);
  });

  it('rejects unknown fields (no mass assignment)', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.patch(`/api/shops/${shop._id}`).send({ isActive: false, code: 'HACKED' });
    expect(res.status).toBe(400);
  });
});

describe('Deactivate / reactivate shop', () => {
  it('15. OWNER can deactivate a shop', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post(`/api/shops/${shop._id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.shop.isActive).toBe(false);
  });

  it('16. staff cannot deactivate a shop', async () => {
    const shop = await createTestShop();
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.post(`/api/shops/${shop._id}/deactivate`);
    expect(res.status).toBe(403);
  });

  it('17. deactivation preserves the shop record', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/shops/${shop._id}/deactivate`);

    const stillExists = await Shop.findById(shop._id);
    expect(stillExists).not.toBeNull();
    expect(stillExists.name).toBe(shop.name);
  });

  it('18. deactivation does not delete inventory transactions', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
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

    await agent.post(`/api/shops/${shop._id}/deactivate`);

    const txn = await InventoryTransaction.findOne({ shopId: shop._id });
    expect(txn).not.toBeNull();
  });

  it('19. deactivation does not remove the shop from user assignments', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/shops/${shop._id}/deactivate`);

    const stillAssigned = await User.findById(manager._id);
    expect(stillAssigned.shopIds.map(String)).toContain(shop._id.toString());
  });

  it('20. OWNER can reactivate a shop', async () => {
    const shop = await createTestShop({ isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post(`/api/shops/${shop._id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.shop.isActive).toBe(true);
  });
});

describe('Audit logging', () => {
  it('21. audit created for shop creation', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/shops').send({ name: 'Audited Shop' });

    const log = await AuditLog.findOne({ action: 'SHOP_CREATED', entityId: res.body.data.shop._id });
    expect(log).not.toBeNull();
    expect(log.userId.toString()).toBe(owner._id.toString());
  });

  it('22. audit created for edit', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.patch(`/api/shops/${shop._id}`).send({ name: 'Edited Name' });

    const log = await AuditLog.findOne({ action: 'SHOP_UPDATED', entityId: shop._id });
    expect(log).not.toBeNull();
  });

  it('23. audit created for deactivate', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/shops/${shop._id}/deactivate`);

    const log = await AuditLog.findOne({ action: 'SHOP_DEACTIVATED', entityId: shop._id });
    expect(log).not.toBeNull();
  });

  it('24. audit created for reactivate', async () => {
    const shop = await createTestShop({ isActive: false });
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    await agent.post(`/api/shops/${shop._id}/reactivate`);

    const log = await AuditLog.findOne({ action: 'SHOP_REACTIVATED', entityId: shop._id });
    expect(log).not.toBeNull();
  });
});

describe('No indirect passwordHash exposure', () => {
  it('25. passwordHash never appears in any shop or shop-staff response', async () => {
    const shop = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shop._id] });
    const agent = await loginAgent(app, owner.email);

    const shopRes = await agent.get(`/api/shops/${shop._id}`);
    expect(JSON.stringify(shopRes.body)).not.toMatch(/passwordHash/i);

    const listRes = await agent.get('/api/shops');
    expect(JSON.stringify(listRes.body)).not.toMatch(/passwordHash/i);

    const staffRes = await agent.get(`/api/shops/${shop._id}/staff`);
    expect(JSON.stringify(staffRes.body)).not.toMatch(/passwordHash/i);
    expect(staffRes.body.data.staff.some((s) => s.email === 'sales@test.dev')).toBe(true);
  });
});
