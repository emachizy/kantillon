import { apiClient } from './client.js';

// Read-only convenience for defaulting a sales-line price in the UI — the
// saved DailySalesReport always stores its own line-level price and never
// re-derives revenue from this later.
export async function fetchCurrentShopPrice(shopId, productId) {
  const { data } = await apiClient.get(`/shop-prices/shop/${shopId}/product/${productId}/current`);
  return data.data.price;
}

// OWNER-only. Closes out whatever price is currently active for this
// shop/product and makes this the new one — see
// server/src/services/shopPriceService.js for the historical-preservation
// guarantee behind this single write path.
export async function setShopPrice({ shopId, productId, priceKobo }) {
  const { data } = await apiClient.post('/shop-prices', { shopId, productId, priceKobo });
  return data.data.price;
}

// OWNER-only bulk reads (no N+1) used by the Manage Product and Manage Shop
// pages' price tables.
export async function fetchCurrentPricesForProduct(productId) {
  const { data } = await apiClient.get(`/shop-prices/product/${productId}/current`);
  return data.data.prices;
}

export async function fetchCurrentPricesForShop(shopId) {
  const { data } = await apiClient.get(`/shop-prices/shop/${shopId}/current`);
  return data.data.prices;
}
