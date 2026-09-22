import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { ShopPrice } from '../src/models/ShopPrice.js';

beforeAll(async () => {
  await startTestDb();
  // The uniqueness guarantee below depends on the partial index existing —
  // make sure it's built before any test runs rather than racing it.
  await ShopPrice.init();
});
afterAll(stopTestDb);
beforeEach(clearTestDb);

describe('ShopPrice historical preservation', () => {
  it('rejects a second currently-active price for the same shop/product', async () => {
    const shopId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const changedBy = new mongoose.Types.ObjectId();

    await ShopPrice.create({ shopId, productId, priceKobo: 75000, changedBy });

    await expect(
      ShopPrice.create({ shopId, productId, priceKobo: 80000, changedBy })
    ).rejects.toThrow();
  });

  it('preserves a superseded price once it is closed out with effectiveTo', async () => {
    const shopId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const changedBy = new mongoose.Types.ObjectId();

    const original = await ShopPrice.create({ shopId, productId, priceKobo: 75000, changedBy });
    original.effectiveTo = new Date();
    await original.save();

    await ShopPrice.create({ shopId, productId, priceKobo: 80000, changedBy });

    const history = await ShopPrice.find({ shopId, productId }).sort({ effectiveFrom: 1 });
    expect(history).toHaveLength(2);
    expect(history[0].priceKobo).toBe(75000);
    expect(history[0].effectiveTo).not.toBeNull();
    expect(history[1].priceKobo).toBe(80000);
    expect(history[1].effectiveTo).toBeNull();
  });

  it('rejects a non-positive price', async () => {
    const price = new ShopPrice({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      priceKobo: 0,
      changedBy: new mongoose.Types.ObjectId(),
    });

    await expect(price.validate()).rejects.toThrow();
  });

  it('rejects a non-integer (fractional kobo) price', async () => {
    const price = new ShopPrice({
      shopId: new mongoose.Types.ObjectId(),
      productId: new mongoose.Types.ObjectId(),
      priceKobo: 750.5,
      changedBy: new mongoose.Types.ObjectId(),
    });

    await expect(price.validate()).rejects.toThrow();
  });
});
