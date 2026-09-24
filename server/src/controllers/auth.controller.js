import { authenticate, changeOwnPassword } from '../services/authService.js';
import { signAuthToken } from '../utils/token.js';
import { getAuthCookieOptions } from '../utils/cookies.js';
import { env } from '../config/env.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await authenticate(email, password);

  const token = signAuthToken(user);
  res.cookie(env.cookieName, token, getAuthCookieOptions());

  sendSuccess(res, { data: { user } });
});

export const logout = catchAsync(async (_req, res) => {
  res.clearCookie(env.cookieName, { ...getAuthCookieOptions(), maxAge: 0 });
  sendSuccess(res, { message: 'Logged out' });
});

export const me = catchAsync(async (req, res) => {
  sendSuccess(res, { data: { user: req.user } });
});

export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await changeOwnPassword(req.user._id, currentPassword, newPassword);
  sendSuccess(res, { data: { user } });
});
