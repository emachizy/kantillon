import axios from 'axios';

// withCredentials is what lets the httpOnly auth cookie travel with each
// request — the token itself is never touched by frontend JavaScript.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
});
