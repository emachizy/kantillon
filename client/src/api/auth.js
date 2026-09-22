import { apiClient } from './client.js';

export async function loginRequest({ email, password }) {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data.data.user;
}

export async function logoutRequest() {
  await apiClient.post('/auth/logout');
}

export async function fetchCurrentUser() {
  const { data } = await apiClient.get('/auth/me');
  return data.data.user;
}
