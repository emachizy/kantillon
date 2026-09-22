import { z } from 'zod';
import mongoose from 'mongoose';

export const objectIdSchema = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' });
