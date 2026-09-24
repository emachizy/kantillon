import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// Vercel's Node runtime requires the module's default export to be a
// request handler function (or an http.Server) — not calling app.listen()
// here. Locally and on Render, src/server.js is still the entrypoint and
// still calls app.listen(); this file exists only so Vercel has a compliant
// export to invoke per request.
const app = createApp();

// This module is evaluated once per cold start and reused across warm
// invocations of the same serverless instance, so this only runs once per
// instance in practice — not once per request. It's deliberately not
// awaited at module scope: Mongoose buffers operations by default until
// the connection is ready, so a request arriving before this resolves
// still succeeds once it does, and mongoose.connect() is a safe no-op if
// a connection already exists (readyState !== 0).
if (mongoose.connection.readyState === 0) {
  connectDB().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('MongoDB connection failed:', err);
  });
}

export default app;
