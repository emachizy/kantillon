import { ShopPrice } from '../models/ShopPrice.js';
import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';

// The currently-active price row (effectiveTo: null) for a shop/product, or
// null if none has ever been set. This is a read-only convenience for the
// frontend to default a sales-line price — it is never the source of truth
// for a historical DailySalesReport's revenue, which always stores its own
// line-level unitPriceKobo permanently (see DailySalesReport model).
export async function getCurrentShopPrice(shopId, productId) {
  return ShopPrice.findOne({ shopId, productId, effectiveTo: null });
}

// Changing a price never updates a row in place — it closes out whatever
// row is currently active (effectiveTo: now) and inserts a new one, so the
// old price remains a permanent, queryable historical record (see the
// model comment on ShopPrice for why). This is a multi-document write with
// no way to genuinely retry from scratch on failure, so it goes through
// runWithOptionalTransaction (see utils/transactionRunner.js) for a real
// atomicity guarantee wherever the deployment supports it, with a
// best-effort compensating rollback on this project's standalone MongoDB.
export async function setShopPrice({ shopId, productId, priceKobo, actingUser, req }) {
  const [shop, product] = await Promise.all([Shop.findById(shopId), Product.findById(productId)]);
  if (!shop) throw ApiError.notFound('Shop not found');
  if (!shop.isActive) throw ApiError.badRequest('Shop is not active');
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isActive) throw ApiError.badRequest('Product is not active');

  const now = new Date();

  const { price, previousPriceKobo } = await runWithOptionalTransaction(async (session) => {
    const previousActive = await ShopPrice.findOneAndUpdate(
      { shopId, productId, effectiveTo: null },
      { effectiveTo: now },
      { session }
    );

    try {
      const [created] = await ShopPrice.create(
        [{ shopId, productId, priceKobo, effectiveFrom: now, changedBy: actingUser._id }],
        { session }
      );
      return { price: created, previousPriceKobo: previousActive?.priceKobo ?? null };
    } catch (err) {
      if (session) {
        // A real transaction is active — it aborts automatically, so the
        // findOneAndUpdate above was never committed either.
        throw err;
      }

      if (err.code === 11000) {
        // No transaction available and someone else's price change won the
        // race between our findOneAndUpdate and this insert — their row is
        // now the valid active price, so reopening the one we just closed
        // would violate the one-active-row invariant. Surface a conflict
        // instead of guessing which price should win.
        throw ApiError.conflict('Another price change is already in progress for this shop/product');
      }

      // Unexpected failure with nothing else now active — reopen the row
      // we closed so this shop/product is never left with zero active
      // prices.
      if (previousActive) {
        await ShopPrice.updateOne({ _id: previousActive._id }, { effectiveTo: null });
      }
      throw err;
    }
  });

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId,
    action: AUDIT_ACTIONS.SHOP_PRICE_CHANGED,
    entityType: 'ShopPrice',
    entityId: price._id,
    previousValue: previousPriceKobo !== null ? { priceKobo: previousPriceKobo } : null,
    newValue: { priceKobo: price.priceKobo, shopId, productId },
  });

  return price;
}

// Every active shop's current price for one product, in two queries (not
// one per shop) — used by the Manage Product page's shop-price table.
export async function getCurrentPricesForProduct(productId) {
  const [shops, prices] = await Promise.all([
    Shop.find({ isActive: true }).sort({ name: 1 }),
    ShopPrice.find({ productId, effectiveTo: null }),
  ]);

  const priceByShop = new Map(prices.map((p) => [p.shopId.toString(), p]));

  return shops.map((shop) => {
    const price = priceByShop.get(shop._id.toString()) ?? null;
    return {
      shop: { id: shop._id, name: shop.name, code: shop.code },
      priceKobo: price?.priceKobo ?? null,
      updatedAt: price?.updatedAt ?? null,
    };
  });
}

// Every active product's current price for one shop, in two queries — used
// by the optional "Products & Prices" section on the Manage Shop page. Both
// this and getCurrentPricesForProduct only ever read ShopPrice; the only
// write path for either view is setShopPrice above.
export async function getCurrentPricesForShop(shopId) {
  const [products, prices] = await Promise.all([
    Product.find({ isActive: true }).sort({ name: 1 }),
    ShopPrice.find({ shopId, effectiveTo: null }),
  ]);

  const priceByProduct = new Map(prices.map((p) => [p.productId.toString(), p]));

  return products.map((product) => {
    const price = priceByProduct.get(product._id.toString()) ?? null;
    return {
      product: { id: product._id, name: product.name, unit: product.unit },
      priceKobo: price?.priceKobo ?? null,
      updatedAt: price?.updatedAt ?? null,
    };
  });
}
