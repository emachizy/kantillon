import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Spawned as real child processes (not run in-process) because
// middleware/rateLimiters.js's skip() always returns true under
// NODE_ENV=test, which would also bypass the exact key-generation code
// path this suite needs to exercise — see tests/fixtures/trustProxyProbe.js
// for the full reasoning. Same pattern as tests/bootstrapOwner.test.js.
const execFileAsync = promisify(execFile);
const PROBE_PATH = path.resolve(process.cwd(), 'tests/fixtures/trustProxyProbe.js');
const RESULT_MARKER = '__TRUST_PROXY_PROBE_RESULT__';

async function runProbe({ nodeEnv, sendXff }) {
  const { stdout, stderr } = await execFileAsync('node', [PROBE_PATH], {
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      MONGO_URI: 'mongodb://127.0.0.1:27017/kantillon_trust_proxy_probe',
      JWT_SECRET: 'trust-proxy-probe-secret',
      PROBE_SEND_XFF: String(sendXff),
    },
  });
  const resultLine = stdout.split('\n').find((line) => line.startsWith(RESULT_MARKER));
  const result = JSON.parse(resultLine.slice(RESULT_MARKER.length));
  return { ...result, combinedOutput: stdout + stderr };
}

describe('trust proxy / express-rate-limit', () => {
  it(
    'production: a request with X-Forwarded-For does not trigger ERR_ERL_UNEXPECTED_X_FORWARDED_FOR',
    async () => {
      const result = await runProbe({ nodeEnv: 'production', sendXff: true });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(400); // reaches validation normally — the rate limiter didn't block it
      expect(result.combinedOutput).not.toMatch(/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
    },
    15000
  );

  it(
    'production: a normal request with no forwarded header still works',
    async () => {
      const result = await runProbe({ nodeEnv: 'production', sendXff: false });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(400);
      expect(result.combinedOutput).not.toMatch(/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
    },
    15000
  );

  it(
    'development: a normal local request (no forwarded header) is unaffected and logs no trust-proxy warning',
    async () => {
      const result = await runProbe({ nodeEnv: 'development', sendXff: false });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(400);
      expect(result.combinedOutput).not.toMatch(/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
    },
    15000
  );

  it(
    'development: trust proxy is intentionally left unset, so a forwarded header there still surfaces the misconfiguration warning',
    async () => {
      const result = await runProbe({ nodeEnv: 'development', sendXff: true });
      expect(result.error).toBeUndefined();
      // Documents current, unchanged, intended behavior: development never
      // calls app.set('trust proxy', 1), so express-rate-limit's own
      // built-in warning is exactly what should still fire here — this is
      // the deliberate "do not trust arbitrary forwarded headers in
      // development" behavior, not a regression to fix.
      expect(result.combinedOutput).toMatch(/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);
    },
    15000
  );
});
