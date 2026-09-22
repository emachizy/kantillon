// Runs all Phase 3 data migrations against MONGO_URI. Every migration here
// is additive and idempotent (see each file) — safe to run against
// development or production, and safe to run more than once. This is
// deliberately NOT guarded against NODE_ENV=production the way seed.js is:
// seed.js is destructive (wipes collections) and inserts throwaway
// credentials, which must never touch production; these migrations do
// neither — backfilling a missing field is exactly the kind of change a
// real production database needs when a schema evolves.
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { migrateShopPricePriceToKobo } from './2026-09-shopprice-price-to-kobo.js';
import {
  migrateStockReceiptBusinessDate,
  migrateInventoryTransactionBusinessDate,
} from './2026-09-business-date-backfill.js';

async function run() {
  await connectDB();
  console.log(`Running migrations against: ${env.mongoUri}`);

  const priceResult = await migrateShopPricePriceToKobo();
  console.log(`ShopPrice price -> priceKobo: ${priceResult.migrated} document(s) migrated`);

  const receiptResult = await migrateStockReceiptBusinessDate();
  console.log(`StockReceipt businessDate backfill: ${receiptResult.migrated} document(s) migrated`);

  const txnResult = await migrateInventoryTransactionBusinessDate();
  console.log(
    `InventoryTransaction businessDate backfill: ${txnResult.migrated} document(s) migrated`
  );

  await disconnectDB();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
