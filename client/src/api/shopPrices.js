import { apiClient } from './client.js';

// Read-only convenience for defaulting a sales-line price in the UI — the
// saved DailySalesReport always stores its own line-level price and never
// re-derives revenue from this later.
export async function fetchCurrentShopPrice(shopId, productId) {
  const { data } = await apiClient.get(`/shop-prices/shop/${shopId}/product/${productId}/current`);
  return data.data.price;
}
