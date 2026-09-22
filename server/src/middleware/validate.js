import { ApiError } from '../utils/ApiError.js';

// Validates req.body (or another request part) against a Zod schema and
// replaces it with the parsed/coerced value so downstream code can trust it.
export function validate(schema, part = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    req[part] = result.data;
    next();
  };
}
