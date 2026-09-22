import { ShopPrice } from '../models/ShopPrice.js';

// The currently-active price row (effectiveTo: null) for a shop/product, or
// null if none has ever been set. This is a read-only convenience for the
// frontend to default a sales-line price — it is never the source of truth
// for a historical DailySalesReport's revenue, which always stores its own
// line-level unitPriceKobo permanently (see DailySalesReport model).
export async function getCurrentShopPrice(shopId, productId) {
  return ShopPrice.findOne({ shopId, productId, effectiveTo: null });
}
