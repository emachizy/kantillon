import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, createTestProduct, loginAgent } from './factories.js';
import { ROLES } from '../src/utils/constants.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { getInventoryBalance } from '../src/services/inventoryService.js';
import { getLagosBusinessDate } from '../src/utils/businessDate.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function createTxn(shop, product, user, overrides = {}) {
  return InventoryTransaction.create({
    shopId: shop._id,
    productId: product._id,
    type: overrides.type || 'ADJUSTMENT',
    direction: overrides.direction || 'IN',
    quantity: overrides.quantity ?? 100,
    status: overrides.status || 'APPROVED',
    createdBy: user._id,
    referenceType: 'MANUAL',
    businessDate: overrides.businessDate || getLagosBusinessDate(),
  });
}

describe('inventory balance calculation', () => {
  it('only counts APPROVED transactions — PENDING and REJECTED are excluded', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });

    await createTxn(shop, product, owner, { direction: 'IN', quantity: 1000, status: 'APPROVED' });
    await createTxn(shop, product, owner, { direction: 'IN', quantity: 300, status: 'PENDING' });
    await createTxn(shop, product, owner, { direction: 'IN', quantity: 200, status: 'REJECTED' });
    await createTxn(shop, product, owner, { direction: 'IN', quantity: 150, status: 'VOIDED' });

    const balance = await getInventoryBalance(shop._id, product._id);
    expect(balance).toBe(1000);
  });

  it('IN transactions increase the balance', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });

    await createTxn(shop, product, owner, { direction: 'IN', quantity: 400, status: 'APPROVED' });
    await createTxn(shop, product, owner, { direction: 'IN', quantity: 100, status: 'APPROVED' });

    expect(await getInventoryBalance(shop._id, product._id)).toBe(500);
  });

  it('OUT transactions decrease the balance', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });

    await createTxn(shop, product, owner, { direction: 'IN', quantity: 1000, status: 'APPROVED' });
    await createTxn(shop, product, owner, { direction: 'OUT', quantity: 350, status: 'APPROVED' });

    expect(await getInventoryBalance(shop._id, product._id)).toBe(650);
  });

  it('an unauthorized user cannot read another shop inventory', async () => {
    const shopA = await createTestShop({ name: 'Shop A' });
    const shopB = await createTestShop({ name: 'Shop B' });
    await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });

    const sales = await loginAgent(app, 'sales@test.dev');
    const res = await sales.get(`/api/inventory/shop/${shopB._id}`);

    expect(res.status).toBe(403);
  });

  it('an ADMIN can read inventory for a shop they are assigned to (read access is not OWNER-only)', async () => {
    const shop = await createTestShop();
    await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev', shopIds: [shop._id] });

    const admin = await loginAgent(app, 'admin@test.dev');
    const res = await admin.get(`/api/inventory/shop/${shop._id}`);

    expect(res.status).toBe(200);
  });
});
