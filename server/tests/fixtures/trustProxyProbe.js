// Standalone probe spawned as a child process by trustProxy.test.js.
//
// This can't be tested in-process: middleware/rateLimiters.js's skip()
// always returns true when NODE_ENV=test (so the automated suite's rapid
// logins never trip it), which would also skip the exact key-generation
// code path this probe needs to exercise. Running in a real child process
// lets NODE_ENV genuinely be "production" or "development" — matching the
// same pattern tests/bootstrapOwner.test.js uses for the same reason.
//
// No MongoDB connection is made or needed: authRateLimiter runs before
// validate(loginSchema) and the login controller, and an intentionally
// empty request body is rejected by validation before anything would ever
// touch the database.
import request from 'supertest';
import { createApp } from '../../src/app.js';

const RESULT_MARKER = '__TRUST_PROXY_PROBE_RESULT__';

async function main() {
  const app = createApp();
  const req = request(app).post('/api/auth/login').send({});
  if (process.env.PROBE_SEND_XFF === 'true') {
    req.set('X-Forwarded-For', '203.0.113.5');
  }
  const res = await req;
  // Printed with a unique marker so the test can pick this one line out of
  // whatever else (morgan access logs, express-rate-limit's own
  // console.warn/console.error diagnostics) also went to stdout/stderr.
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ status: res.status, body: res.body })}\n`);
}

main().catch((err) => {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ error: err.message })}\n`);
  process.exitCode = 1;
});
