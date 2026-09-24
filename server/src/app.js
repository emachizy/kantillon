import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { env, isProduction } from './config/env.js';

export function createApp() {
  const app = express();

  // Vercel (and Render) sit in front of this app as a reverse proxy and set
  // X-Forwarded-For. Without trusting the proxy, two things go wrong:
  // Express's own req.ip falls back to the proxy's socket address instead
  // of the real client IP, and express-rate-limit logs a
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR misconfiguration warning on every
  // request (ip-based rate limiting is still applied, just against the
  // wrong address). This must be set before authRateLimiter (mounted via
  // routes below) ever runs. Left unset in development, where there is no
  // proxy and the header should never be trusted.
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json());
  if (!isProduction) {
    app.use(morgan('dev'));
  }

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
