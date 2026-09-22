import { apiClient } from './client.js';

export async function submitDailyReport({
  shopId,
  productId,
  businessDate,
  salesLines,
  physicalClosingStockQuantity,
  actualAmountCollectedKobo,
  notes,
}) {
  const { data } = await apiClient.post('/daily-reports', {
    shopId,
    productId,
    businessDate,
    salesLines,
    physicalClosingStockQuantity,
    actualAmountCollectedKobo,
    notes,
  });
  return data.data;
}

export async function fetchDailyReports(params = {}) {
  const { data } = await apiClient.get('/daily-reports', { params });
  return data.data.reports;
}

export async function fetchDailyReport(id) {
  const { data } = await apiClient.get(`/daily-reports/${id}`);
  return data.data.report;
}

export async function fetchDailySummary(businessDate) {
  const { data } = await apiClient.get('/daily-reports/summary', { params: { businessDate } });
  return data.data;
}
