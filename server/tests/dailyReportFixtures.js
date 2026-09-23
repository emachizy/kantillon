import { createTestUser, createTestShop, createTestProduct } from './factories.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { ROLES } from '../src/utils/constants.js';

// Shared Phase 4 fixture helpers. Not a test file itself (no describe/it).

export async function createOpeningStockDirect(shop, product, owner, quantity, businessDate) {
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

export async function setupShopWithUsers() {
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

// A "clean" baseline report — zero stock/money variance — for correction
// tests, so variance-resolution blocking never interferes.
export function cleanReportPayload(shop, product, overrides = {}) {
  return {
    shopId: shop._id.toString(),
    productId: product._id.toString(),
    businessDate: '2020-01-10',
    salesLines: [{ quantity: 400, unitPriceKobo: 1200000 }],
    physicalClosingStockQuantity: 1100,
    actualAmountCollectedKobo: 480000000,
    ...overrides,
  };
}

// A baseline report WITH a stock (-3) and money (-₦25,000) variance, for
// variance-resolution tests.
export function variantReportPayload(shop, product, overrides = {}) {
  return {
    shopId: shop._id.toString(),
    productId: product._id.toString(),
    businessDate: '2020-01-10',
    salesLines: [
      { quantity: 250, unitPriceKobo: 1200000 },
      { quantity: 150, unitPriceKobo: 1250000 },
    ],
    physicalClosingStockQuantity: 1097,
    actualAmountCollectedKobo: 485000000,
    ...overrides,
  };
}
