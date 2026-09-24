import { apiClient } from './client.js';

// The backend already scopes this to the caller's assigned shops (OWNER
// sees all) — the frontend never filters shop visibility itself.
// `includeInactive` is honored server-side for OWNER only (see
// server/src/services/shopService.js); every other caller always gets
// active shops regardless of what is passed here.
export async function fetchShops({ includeInactive } = {}) {
  const { data } = await apiClient.get('/shops', {
    params: includeInactive ? { includeInactive: 'true' } : undefined,
  });
  return data.data.shops;
}

export async function fetchShop(id) {
  const { data } = await apiClient.get(`/shops/${id}`);
  return data.data.shop;
}

export async function createShop({ name, address, phone, notes }) {
  const { data } = await apiClient.post('/shops', { name, address, phone, notes });
  return data.data.shop;
}

export async function updateShop({ id, ...updates }) {
  const { data } = await apiClient.patch(`/shops/${id}`, updates);
  return data.data.shop;
}

export async function deactivateShop(id) {
  const { data } = await apiClient.post(`/shops/${id}/deactivate`);
  return data.data.shop;
}

export async function reactivateShop(id) {
  const { data } = await apiClient.post(`/shops/${id}/reactivate`);
  return data.data.shop;
}
