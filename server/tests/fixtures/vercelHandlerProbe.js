// Standalone probe spawned as a child process by vercelHandler.test.js.
//
// Run out-of-process so MONGO_URI can point at something genuinely
// unreachable (env.js reads it once at import time, so an in-process test
// can't swap it between cases without re-importing the whole module graph).
import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import handler from '../../api/index.js';

const RESULT_MARKER = '__VERCEL_HANDLER_PROBE_RESULT__';

async function main() {
  if (process.env.PROBE_MODE === 'failure') {
    // A rejected connectDB() throws before the handler ever calls
    // app(req, res) (see api/index.js), so bare stand-ins never actually
    // reach Express here — no real http layer is needed for this case.
    await handler({}, {});
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ threw: false })}\n`);
    return;
  }

  // The success case does reach Express, which needs a real request/
  // response — wrapping the handler in a real http.Server and driving it
  // with supertest exercises it exactly as Vercel's Node runtime would.
  const server = http.createServer(handler);
  const res = await request(server).get('/api/health');
  server.close();
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ threw: false, status: res.status })}\n`);
}

main()
  .catch((err) => {
    process.stdout.write(`${RESULT_MARKER}${JSON.stringify({ threw: true, message: err.message })}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Without this, an open Mongo connection keeps the event loop alive and
    // the child process never exits on its own, which would otherwise hang
    // whatever spawned this (execFile only resolves once the process exits).
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
