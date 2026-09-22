import { apiClient } from './client.js';

export async function submitStockReceipt({ shopId, productId, quantity, deliveryReference, notes }) {
  const { data } = await apiClient.post('/stock-receipts', {
    shopId,
    productId,
    quantity,
    deliveryReference,
    notes,
  });
  return data.data;
}

export async function fetchPendingReceipts() {
  const { data } = await apiClient.get('/stock-receipts/pending');
  return data.data.receipts;
}

export async function approveReceipt(id) {
  const { data } = await apiClient.post(`/stock-receipts/${id}/approve`);
  return data.data;
}

export async function rejectReceipt(id, reason) {
  const { data } = await apiClient.post(`/stock-receipts/${id}/reject`, { reason });
  return data.data;
}

export async function fetchReceiptHistory(params = {}) {
  const { data } = await apiClient.get('/stock-receipts', { params });
  return data.data.receipts;
}
