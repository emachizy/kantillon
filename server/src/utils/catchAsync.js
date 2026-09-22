// Wraps an async controller so rejected promises reach the centralized error handler
// instead of needing a try/catch in every controller.
export function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
