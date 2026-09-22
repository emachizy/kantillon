import { apiClient } from './client.js';

export async function fetchShopInventory(shopId) {
  const { data } = await apiClient.get(`/inventory/shop/${shopId}`);
  return data.data;
}

export async function createOpeningStock({ shopId, productId, quantity, notes }) {
  const { data } = await apiClient.post('/inventory/opening-stock', {
    shopId,
    productId,
    quantity,
    notes,
  });
  return data.data;
}
