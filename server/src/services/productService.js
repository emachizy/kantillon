import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';

const PRODUCT_FIELDS = ['name', 'unit'];

function snapshot(product) {
  return { name: product.name, unit: product.unit };
}

// `sku` is a required, unique identifier on the Product model, but the
// OWNER never types one — the create API only asks for name (+ optional
// unit), mirroring services/shopService.js's generateUniqueShopCode for the
// exact same reason: a collision (e.g. two products both named "Cement")
// must never surface as a confusing unique-index error to the caller.
async function generateUniqueProductSku(name) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'PRODUCT';

  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Product.exists({ sku: candidate })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export async function createProduct({ name, unit, actingUser, req }) {
  const sku = await generateUniqueProductSku(name);
  const product = await Product.create({ name, sku, unit });

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.PRODUCT_CREATED,
    entityType: 'Product',
    entityId: product._id,
    newValue: snapshot(product),
  });

  return product;
}

// `includeInactive` is OWNER-only (enforced in the controller) — every
// other role always sees active products only, matching
// services/shopService.js's listShops split.
export async function listProducts({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  return Product.find(filter).sort({ name: 1 });
}

export async function getProductDetail(productId) {
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');
  return product;
}

export async function updateProduct({ id, updates, actingUser, req }) {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product not found');

  const previousValue = snapshot(product);
  for (const field of PRODUCT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      product[field] = updates[field];
    }
  }
  await product.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.PRODUCT_UPDATED,
    entityType: 'Product',
    entityId: product._id,
    previousValue,
    newValue: snapshot(product),
  });

  return product;
}

export async function deactivateProduct({ id, actingUser, req }) {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isActive) throw ApiError.conflict('Product is already inactive');

  product.isActive = false;
  await product.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
    entityType: 'Product',
    entityId: product._id,
  });

  return product;
}

export async function reactivateProduct({ id, actingUser, req }) {
  const product = await Product.findById(id);
  if (!product) throw ApiError.notFound('Product not found');
  if (product.isActive) throw ApiError.conflict('Product is already active');

  product.isActive = true;
  await product.save();

  await recordAudit({
    req,
    userId: actingUser._id,
    action: AUDIT_ACTIONS.PRODUCT_REACTIVATED,
    entityType: 'Product',
    entityId: product._id,
  });

  return product;
}
