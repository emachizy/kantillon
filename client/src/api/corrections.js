import { apiClient } from './client.js';

export async function requestCorrection(reportId, payload) {
  const { data } = await apiClient.post(`/daily-reports/${reportId}/corrections`, payload);
  return data.data.request;
}

export async function fetchCorrectionsForReport(reportId) {
  const { data } = await apiClient.get(`/daily-reports/${reportId}/corrections`);
  return data.data.requests;
}

export async function fetchPendingCorrectionRequests() {
  const { data } = await apiClient.get('/correction-requests/pending');
  return data.data.requests;
}

export async function approveCorrectionRequest(id) {
  const { data } = await apiClient.post(`/correction-requests/${id}/approve`);
  return data.data;
}

export async function rejectCorrectionRequest(id, reason) {
  const { data } = await apiClient.post(`/correction-requests/${id}/reject`, { reason });
  return data.data.request;
}

export async function fetchEffectiveReport(reportId) {
  const { data } = await apiClient.get(`/daily-reports/${reportId}/effective`);
  return data.data;
}
