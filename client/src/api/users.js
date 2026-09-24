import { apiClient } from './client.js';

// OWNER-only endpoints — the backend enforces this on every route; the
// frontend only hides the UI, never relies on that alone.
export async function fetchUsers(params = {}) {
  const { data } = await apiClient.get('/users', { params });
  return data.data.users;
}

export async function fetchUserById(id) {
  const { data } = await apiClient.get(`/users/${id}`);
  return data.data.user;
}

export async function createUser({ name, email, phone, role, shopIds, temporaryPassword }) {
  const { data } = await apiClient.post('/users', { name, email, phone, role, shopIds, temporaryPassword });
  return data.data.user;
}

export async function updateUser({ id, ...updates }) {
  const { data } = await apiClient.patch(`/users/${id}`, updates);
  return data.data.user;
}

export async function deactivateUser(id) {
  const { data } = await apiClient.post(`/users/${id}/deactivate`);
  return data.data.user;
}

export async function reactivateUser(id) {
  const { data } = await apiClient.post(`/users/${id}/reactivate`);
  return data.data.user;
}

export async function resetUserPassword({ id, newTemporaryPassword }) {
  const { data } = await apiClient.post(`/users/${id}/reset-password`, { newTemporaryPassword });
  return data.data.user;
}

export async function fetchShopStaff(shopId) {
  const { data } = await apiClient.get(`/shops/${shopId}/staff`);
  return data.data.staff;
}
