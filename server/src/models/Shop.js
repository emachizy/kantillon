import mongoose from 'mongoose';

const { Schema } = mongoose;

const shopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    notes: { type: String, trim: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Shop = mongoose.model('Shop', shopSchema);
