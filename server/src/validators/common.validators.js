import { z } from 'zod';
import mongoose from 'mongoose';
import { isValidBusinessDateFormat } from '../utils/businessDate.js';

export const objectIdSchema = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' });

// Canonical "YYYY-MM-DD" business date (Africa/Lagos) — format AND
// calendar validity (rejects e.g. 2026-02-30). Future-date and
// closed-business-day rules are business logic, checked in the service
// layer, not here.
export const businessDateSchema = z
  .string()
  .refine(isValidBusinessDateFormat, { message: 'businessDate must be a valid YYYY-MM-DD date' });
