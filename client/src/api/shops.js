import { apiClient } from './client.js';

// The backend already scopes this to the caller's assigned shops (OWNER
// sees all) — the frontend never filters shop visibility itself.
export async function fetchShops() {
  const { data } = await apiClient.get('/shops');
  return data.data.shops;
}
