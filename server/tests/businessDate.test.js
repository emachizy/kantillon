import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import {
  getLagosBusinessDate,
  isValidBusinessDateFormat,
  isFutureBusinessDate,
  compareBusinessDates,
} from '../src/utils/businessDate.js';
import { migrateShopPricePriceToKobo } from '../src/migrations/2026-09-shopprice-price-to-kobo.js';
import {
  migrateStockReceiptBusinessDate,
  migrateInventoryTransactionBusinessDate,
} from '../src/migrations/2026-09-business-date-backfill.js';

describe('Africa/Lagos business-date helper', () => {
  it('returns a canonical YYYY-MM-DD string', () => {
    const result = getLagosBusinessDate(new Date('2026-09-22T12:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is timezone-correct near the UTC day boundary, not server-local', () => {
    // 23:30 UTC on Sept 22 is already 00:30 the next day in Africa/Lagos
    // (UTC+1, no DST) — the business date must roll over accordingly.
    expect(getLagosBusinessDate(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23');
    expect(getLagosBusinessDate(new Date('2026-09-22T22:30:00Z'))).toBe('2026-09-22');
  });

  it('validates format and calendar correctness', () => {
    expect(isValidBusinessDateFormat('2026-09-22')).toBe(true);
    expect(isValidBusinessDateFormat('2026-13-01')).toBe(false); // no month 13
    expect(isValidBusinessDateFormat('2026-02-30')).toBe(false); // no Feb 30
    expect(isValidBusinessDateFormat('not-a-date')).toBe(false);
    expect(isValidBusinessDateFormat('2026-9-2')).toBe(false); // must be zero-padded
  });

  it('compares business dates lexicographically/chronologically', () => {
    expect(compareBusinessDates('2026-09-20', '2026-09-22')).toBeLessThan(0);
    expect(compareBusinessDates('2026-09-22', '2026-09-20')).toBeGreaterThan(0);
    expect(compareBusinessDates('2026-09-22', '2026-09-22')).toBe(0);
  });

  it('detects a future business date relative to a reference instant', () => {
    const reference = new Date('2026-09-22T10:00:00Z');
    expect(isFutureBusinessDate('2026-09-23', reference)).toBe(true);
    expect(isFutureBusinessDate('2026-09-22', reference)).toBe(false);
    expect(isFutureBusinessDate('2026-09-21', reference)).toBe(false);
  });
});

describe('business-date / money migration idempotency', () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(clearTestDb);

  it('backfills ShopPrice.price into priceKobo and removes the legacy field, then is a no-op on rerun', async () => {
    const collection = mongoose.connection.collection('shopprices');
    const { insertedId } = await collection.insertOne({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      price: 750,
      effectiveFrom: new Date(),
      effectiveTo: null,
      changedBy: new mongoose.Types.ObjectId(),
    });

    const first = await migrateShopPricePriceToKobo();
    expect(first.migrated).toBe(1);

    const afterFirst = await collection.findOne({ _id: insertedId });
    expect(afterFirst.priceKobo).toBe(75000);
    expect(afterFirst.price).toBeUndefined();

    const second = await migrateShopPricePriceToKobo();
    expect(second.migrated).toBe(0);

    const afterSecond = await collection.findOne({ _id: insertedId });
    expect(afterSecond.priceKobo).toBe(75000);
  });

  it('backfills StockReceipt.businessDate from receivedAt, then is a no-op on rerun', async () => {
    const collection = mongoose.connection.collection('stockreceipts');
    const receivedAt = new Date('2026-09-22T23:30:00Z');
    const { insertedId } = await collection.insertOne({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      quantity: 100,
      receivedBy: new mongoose.Types.ObjectId(),
      receivedAt,
      status: 'PENDING',
    });

    const first = await migrateStockReceiptBusinessDate();
    expect(first.migrated).toBe(1);

    const afterFirst = await collection.findOne({ _id: insertedId });
    expect(afterFirst.businessDate).toBe('2026-09-23');

    const second = await migrateStockReceiptBusinessDate();
    expect(second.migrated).toBe(0);
  });

  it('backfills InventoryTransaction.businessDate, preferring a linked receipt businessDate, then is a no-op on rerun', async () => {
    const receiptCollection = mongoose.connection.collection('stockreceipts');
    const txnCollection = mongoose.connection.collection('inventorytransactions');

    const { insertedId: receiptId } = await receiptCollection.insertOne({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      quantity: 100,
      receivedBy: new mongoose.Types.ObjectId(),
      receivedAt: new Date('2026-09-20T08:00:00Z'),
      businessDate: '2026-09-20',
      status: 'APPROVED',
    });

    const { insertedId: receiptTxnId } = await txnCollection.insertOne({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      type: 'STOCK_RECEIPT',
      direction: 'IN',
      quantity: 100,
      referenceType: 'STOCK_RECEIPT',
      referenceId: receiptId,
      status: 'APPROVED',
      createdBy: new mongoose.Types.ObjectId(),
      // createdAt deliberately different from the receipt's businessDate,
      // to prove the migration prefers the linked receipt's date.
      createdAt: new Date('2026-09-21T08:00:00Z'),
    });

    const { insertedId: openingTxnId } = await txnCollection.insertOne({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      type: 'OPENING_STOCK',
      direction: 'IN',
      quantity: 1000,
      referenceType: 'OPENING_STOCK',
      status: 'APPROVED',
      createdBy: new mongoose.Types.ObjectId(),
      approvedAt: new Date('2026-09-18T08:00:00Z'),
    });

    const first = await migrateInventoryTransactionBusinessDate();
    expect(first.migrated).toBe(2);

    const migratedReceiptTxn = await txnCollection.findOne({ _id: receiptTxnId });
    expect(migratedReceiptTxn.businessDate).toBe('2026-09-20');

    const migratedOpeningTxn = await txnCollection.findOne({ _id: openingTxnId });
    expect(migratedOpeningTxn.businessDate).toBe('2026-09-18');

    const second = await migrateInventoryTransactionBusinessDate();
    expect(second.migrated).toBe(0);
  });
});
