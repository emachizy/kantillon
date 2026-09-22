// Consistent success envelope used by every controller.
export function sendSuccess(res, { statusCode = 200, data = null, message = undefined, meta = undefined } = {}) {
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data,
    ...(meta ? { meta } : {}),
  });
}
