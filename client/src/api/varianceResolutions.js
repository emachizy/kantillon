import { apiClient } from './client.js';

export async function createStockVarianceResolution(reportId, payload) {
  const { data } = await apiClient.post(`/daily-reports/${reportId}/stock-variance-resolutions`, payload);
  return data.data;
}

export async function fetchStockVarianceResolutions(reportId) {
  const { data } = await apiClient.get(`/daily-reports/${reportId}/stock-variance-resolutions`);
  return data.data.resolutions;
}

export async function reverseStockVarianceResolution(id, reason) {
  const { data } = await apiClient.post(`/stock-variance-resolutions/${id}/reverse`, { reason });
  return data.data;
}

export async function createMoneyVarianceResolution(reportId, payload) {
  const { data } = await apiClient.post(`/daily-reports/${reportId}/money-variance-resolutions`, payload);
  return data.data;
}

export async function fetchMoneyVarianceResolutions(reportId) {
  const { data } = await apiClient.get(`/daily-reports/${reportId}/money-variance-resolutions`);
  return data.data.resolutions;
}

export async function reverseMoneyVarianceResolution(id, reason) {
  const { data } = await apiClient.post(`/money-variance-resolutions/${id}/reverse`, { reason });
  return data.data;
}
