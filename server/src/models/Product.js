import mongoose from 'mongoose';

const { Schema } = mongoose;

// Deliberately generic: no cement-specific fields. Today it's Lafarge Cement
// bags; tomorrow it could be any product sold by unit count.
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    unit: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Product = mongoose.model('Product', productSchema);
