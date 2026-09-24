import {
  createStaffUser,
  listUsers,
  getUserDetail,
  updateUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
} from '../services/userManagementService.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { catchAsync } from '../utils/catchAsync.js';

export const postCreateUser = catchAsync(async (req, res) => {
  const { name, email, phone, role, shopIds, temporaryPassword } = req.body;
  const user = await createStaffUser({
    name,
    email,
    phone,
    role,
    shopIds,
    temporaryPassword,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { statusCode: 201, data: { user } });
});

export const getUsersHandler = catchAsync(async (req, res) => {
  const users = await listUsers(req.query);
  sendSuccess(res, { data: { users } });
});

export const getUserByIdHandler = catchAsync(async (req, res) => {
  const user = await getUserDetail(req.params.id);
  sendSuccess(res, { data: { user } });
});

export const patchUserHandler = catchAsync(async (req, res) => {
  const user = await updateUser({ id: req.params.id, updates: req.body, actingUser: req.user, req });
  sendSuccess(res, { data: { user } });
});

export const postDeactivateUser = catchAsync(async (req, res) => {
  const user = await deactivateUser({ id: req.params.id, actingUser: req.user, req });
  sendSuccess(res, { data: { user } });
});

export const postReactivateUser = catchAsync(async (req, res) => {
  const user = await reactivateUser({ id: req.params.id, actingUser: req.user, req });
  sendSuccess(res, { data: { user } });
});

export const postResetPasswordHandler = catchAsync(async (req, res) => {
  const user = await resetUserPassword({
    id: req.params.id,
    newTemporaryPassword: req.body.newTemporaryPassword,
    actingUser: req.user,
    req,
  });
  sendSuccess(res, { data: { user } });
});
