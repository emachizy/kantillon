import mongoose from 'mongoose';
import { getLagosBusinessDate } from '../utils/businessDate.js';

// Backfills businessDate onto pre-Phase-3 StockReceipt and
// InventoryTransaction documents that predate the field. Idempotent (only
// touches documents missing businessDate) and purely additive — never
// deletes or overwrites existing data, safe to run in any environment
// including production, and safe to run more than once.
//
// Run StockReceipt first: InventoryTransaction rows of type STOCK_RECEIPT
// prefer to inherit their linked receipt's businessDate (once backfilled)
// so the two stay consistent with each other, rather than each computing
// its own independently from a slightly different timestamp.
export async function migrateStockReceiptBusinessDate() {
  const collection = mongoose.connection.collection('stockreceipts');
  const cursor = collection.find({ businessDate: { $exists: false } });

  let migrated = 0;
  for await (const doc of cursor) {
    const businessDate = getLagosBusinessDate(doc.receivedAt || doc.createdAt);
    // eslint-disable-next-line no-await-in-loop
    await collection.updateOne({ _id: doc._id }, { $set: { businessDate } });
    migrated += 1;
  }

  return { migrated };
}

export async function migrateInventoryTransactionBusinessDate() {
  const txnCollection = mongoose.connection.collection('inventorytransactions');
  const receiptCollection = mongoose.connection.collection('stockreceipts');
  const cursor = txnCollection.find({ businessDate: { $exists: false } });

  let migrated = 0;
  for await (const doc of cursor) {
    let businessDate;
    if (doc.type === 'STOCK_RECEIPT' && doc.referenceId) {
      // eslint-disable-next-line no-await-in-loop
      const receipt = await receiptCollection.findOne({ _id: doc.referenceId });
      businessDate = receipt?.businessDate || getLagosBusinessDate(doc.createdAt);
    } else {
      // OPENING_STOCK (and any other pre-Phase-3 type) has no separate
      // "received" timestamp of its own — createdAt/approvedAt are the
      // same moment for an opening-stock transaction (see
      // openingStockService.js), so either is a reasonable source.
      businessDate = getLagosBusinessDate(doc.approvedAt || doc.createdAt);
    }
    // eslint-disable-next-line no-await-in-loop
    await txnCollection.updateOne({ _id: doc._id }, { $set: { businessDate } });
    migrated += 1;
  }

  return { migrated };
}
