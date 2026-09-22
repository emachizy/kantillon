import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { InventoryTransaction } from '../src/models/InventoryTransaction.js';
import { getLagosBusinessDate } from '../src/utils/businessDate.js';

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

function baseTxn(overrides = {}) {
  return new InventoryTransaction({
    shopId: new mongoose.Types.ObjectId(),
    productId: new mongoose.Types.ObjectId(),
    type: 'STOCK_RECEIPT',
    direction: 'IN',
    quantity: 10,
    createdBy: new mongoose.Types.ObjectId(),
    businessDate: getLagosBusinessDate(),
    ...overrides,
  });
}

describe('InventoryTransaction quantity validation', () => {
  it('accepts a positive quantity', async () => {
    const txn = baseTxn({ quantity: 5 });
    await expect(txn.validate()).resolves.toBeUndefined();
  });

  it('rejects a zero quantity', async () => {
    const txn = baseTxn({ quantity: 0 });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects a negative quantity', async () => {
    const txn = baseTxn({ quantity: -10 });
    await expect(txn.validate()).rejects.toThrow();
  });

  it('rejects an unrecognized transaction type', async () => {
    const txn = baseTxn({ type: 'NOT_A_REAL_TYPE' });
    await expect(txn.validate()).rejects.toThrow();
  });
});
