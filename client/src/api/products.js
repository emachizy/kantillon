import { apiClient } from './client.js';

// Products are not shop-scoped — every authenticated user can read them.
// `includeInactive` is honored server-side for OWNER only (see
// server/src/controllers/product.controller.js); every other caller
// always gets active products regardless of what is passed here.
export async function fetchProducts({ includeInactive } = {}) {
  const { data } = await apiClient.get('/products', {
    params: includeInactive ? { includeInactive: 'true' } : undefined,
  });
  return data.data.products;
}

export async function fetchProduct(id) {
  const { data } = await apiClient.get(`/products/${id}`);
  return data.data.product;
}

export async function createProduct({ name, unit }) {
  const { data } = await apiClient.post('/products', { name, unit });
  return data.data.product;
}

export async function updateProduct({ id, ...updates }) {
  const { data } = await apiClient.patch(`/products/${id}`, updates);
  return data.data.product;
}

export async function deactivateProduct(id) {
  const { data } = await apiClient.post(`/products/${id}/deactivate`);
  return data.data.product;
}

export async function reactivateProduct(id) {
  const { data } = await apiClient.post(`/products/${id}/reactivate`);
  return data.data.product;
}
