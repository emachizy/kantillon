import mongoose from 'mongoose';
import { nairaToKobo } from '../utils/money.js';

// Backfills legacy ShopPrice.price (a plain Naira Number) into the new
// priceKobo (integer kobo) field, then removes the old field so there is
// never more than one authoritative price representation on a document.
//
// Idempotent and safe to run in any environment, including production:
// it only touches documents that don't yet have priceKobo set, and only
// ever adds/renames a field — it never deletes a document. Operates on the
// raw collection (not the Mongoose model) specifically so it can read the
// legacy `price` field even after the schema has moved on and no longer
// declares it.
export async function migrateShopPricePriceToKobo() {
  const collection = mongoose.connection.collection('shopprices');
  const cursor = collection.find({ priceKobo: { $exists: false }, price: { $exists: true } });

  let migrated = 0;
  for await (const doc of cursor) {
    const priceKobo = nairaToKobo(doc.price);
    // eslint-disable-next-line no-await-in-loop
    await collection.updateOne({ _id: doc._id }, { $set: { priceKobo }, $unset: { price: '' } });
    migrated += 1;
  }

  return { migrated };
}
