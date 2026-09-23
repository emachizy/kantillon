import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { getLagosBusinessDate } from '../src/utils/businessDate.js';

beforeAll(async () => {
  await startTestDb();
  await InventoryTransaction.init();
});
afterAll(stopTestDb);
beforeEach(clearTestDb);

function baseTxn(overrides = {}) {
  return new InventoryTransaction({
    shopId: new mongoose.Types.ObjectId(),
    productId: new mongoose.Types.ObjectId(),
    quantity: 10,
    createdBy: new mongoose.Types.ObjectId(),
    businessDate: getLagosBusinessDate(),
    ...overrides,
  });
}

describe('InventoryTransaction type/direction invariants', () => {
  it('rejects OPENING_STOCK + OUT', async () => {
    const txn = baseTxn({ type: 'OPENING_STOCK', direction: 'OUT' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects STOCK_RECEIPT + OUT', async () => {
    const txn = baseTxn({ type: 'STOCK_RECEIPT', direction: 'OUT' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects SALE + IN', async () => {
    const txn = baseTxn({ type: 'SALE', direction: 'IN' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects DAMAGE + IN', async () => {
    const txn = baseTxn({ type: 'DAMAGE', direction: 'IN' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects SHORTAGE + IN', async () => {
    const txn = baseTxn({ type: 'SHORTAGE', direction: 'IN' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects SURPLUS + OUT', async () => {
    const txn = baseTxn({ type: 'SURPLUS', direction: 'OUT' });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('allows REVERSAL + IN', async () => {
    const txn = baseTxn({ type: 'REVERSAL', direction: 'IN' });
    await expect(txn.validate()).resolves.toBeUndefined();
  });

  it('allows REVERSAL + OUT', async () => {
    const txn = baseTxn({ type: 'REVERSAL', direction: 'OUT' });
    await expect(txn.validate()).resolves.toBeUndefined();
  });

  it('still allows every legitimate historical combination', async () => {
    await expect(baseTxn({ type: 'OPENING_STOCK', direction: 'IN' }).validate()).resolves.toBeUndefined();
    await expect(baseTxn({ type: 'STOCK_RECEIPT', direction: 'IN' }).validate()).resolves.toBeUndefined();
    await expect(baseTxn({ type: 'SALE', direction: 'OUT' }).validate()).resolves.toBeUndefined();
    await expect(baseTxn({ type: 'DAMAGE', direction: 'OUT' }).validate()).resolves.toBeUndefined();
    await expect(baseTxn({ type: 'SHORTAGE', direction: 'OUT' }).validate()).resolves.toBeUndefined();
    await expect(baseTxn({ type: 'SURPLUS', direction: 'IN' }).validate()).resolves.toBeUndefined();
  });
});

describe('InventoryTransaction effectKey idempotency', () => {
  it('rejects a duplicate effectKey at the database level', async () => {
    const shopId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const businessDate = getLagosBusinessDate();

    await InventoryTransaction.create({
      shopId,
      productId,
      type: 'DAMAGE',
      direction: 'OUT',
      quantity: 2,
      status: 'APPROVED',
      createdBy,
      businessDate,
      effectKey: 'stock-resolution:test-id-1:adjustment',
    });

    await expect(
      InventoryTransaction.create({
        shopId,
        productId,
        type: 'DAMAGE',
        direction: 'OUT',
        quantity: 2,
        status: 'APPROVED',
        createdBy,
        businessDate,
        effectKey: 'stock-resolution:test-id-1:adjustment',
      })
    ).rejects.toThrow();
  });

  it('does not constrain transactions with no effectKey (sparse index)', async () => {
    const shopId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const businessDate = getLagosBusinessDate();

    // Two transactions with no effectKey at all must NOT collide, since
    // Phase 1-3 transactions never set this field.
    await InventoryTransaction.create({
      shopId,
      productId,
      type: 'DAMAGE',
      direction: 'OUT',
      quantity: 1,
      status: 'APPROVED',
      createdBy,
      businessDate,
    });
    await expect(
      InventoryTransaction.create({
        shopId,
        productId,
        type: 'DAMAGE',
        direction: 'OUT',
        quantity: 1,
        status: 'APPROVED',
        createdBy,
        businessDate,
      })
    ).resolves.toBeTruthy();
  });
});
