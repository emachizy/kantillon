import mongoose from 'mongoose';
import { sendSuccess } from '../utils/apiResponse.js';

const READY_STATE_LABELS = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function health(_req, res) {
  sendSuccess(res, {
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      database: READY_STATE_LABELS[mongoose.connection.readyState] || 'unknown',
    },
  });
}
