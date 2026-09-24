import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// Run out-of-process (see tests/fixtures/vercelHandlerProbe.js) since
// env.js reads MONGO_URI once at import time, so an unreachable-Mongo case
// needs a fresh process rather than swapping it mid-suite.
const execFileAsync = promisify(execFile);
const PROBE_PATH = path.resolve(process.cwd(), 'tests/fixtures/vercelHandlerProbe.js');
const RESULT_MARKER = '__VERCEL_HANDLER_PROBE_RESULT__';

async function runProbe({ mongoUri, mode }) {
  try {
    const { stdout } = await execFileAsync('node', [PROBE_PATH], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MONGO_URI: mongoUri,
        JWT_SECRET: 'vercel-handler-probe-secret',
        PROBE_MODE: mode,
      },
    });
    return parseResult(stdout);
  } catch (err) {
    // execFile rejects on a non-zero exit code — the probe still printed
    // its marker line to stdout before exiting 1.
    return parseResult(err.stdout);
  }
}

function parseResult(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith(RESULT_MARKER));
  return JSON.parse(line.slice(RESULT_MARKER.length));
}

describe('Vercel entrypoint (server/api/index.js)', () => {
  it(
    'lets a real MongoDB connection failure fail loudly instead of swallowing it',
    async () => {
      // Port 1 on localhost is not a Mongo server; a short
      // serverSelectionTimeoutMS keeps this fast instead of waiting out the
      // driver's 30s default.
      const result = await runProbe({
        mongoUri: 'mongodb://127.0.0.1:1/does-not-exist?serverSelectionTimeoutMS=1000',
        mode: 'failure',
      });
      expect(result.threw).toBe(true);
      expect(result.message).toBeTruthy();
    },
    15000
  );

  it(
    'awaits a real MongoDB connection and serves a request through Express once connected',
    async () => {
      const result = await runProbe({
        mongoUri: 'mongodb://127.0.0.1:27017/kantillon_vercel_handler_probe',
        mode: 'success',
      });
      expect(result.threw).toBe(false);
      expect(result.status).toBe(200);
    },
    15000
  );
});
