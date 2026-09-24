import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// Vercel's Node runtime requires the module's default export to be a
// request handler function (or an http.Server) — not calling app.listen()
// here. Locally and on Render, src/server.js is still the entrypoint and
// still calls app.listen(); this file exists only so Vercel has a compliant
// export to invoke per request.
const app = createApp();

// The connection is awaited on every invocation before any request reaches
// Express. On a warm invocation this is a no-op (readyState is already 1),
// so it costs nothing once connected. If Mongo genuinely can't be reached —
// e.g. Atlas blocking Vercel's outbound IP — this must fail loudly rather
// than let Express (and Mongoose's default command buffering) hang the
// request until an unrelated timeout: the error is logged with full detail
// here and then rethrown, which Vercel surfaces as a 500 with that log
// attached to the invocation, not swallowed.
export default async function handler(req, res) {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('MongoDB connection failed:', err);
      throw err;
    }
  }

  return app(req, res);
}
