import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { getInventoryBalance, hasOpeningStock } from './inventoryService.js';

// Opening stock is a one-time initialization (see model comment on
// InventoryTransaction), not a way to correct stock later — that will be an
// adjustment/reversal workflow in a future phase. It is always created
// directly as APPROVED because there is no one else who needs to approve
// the owner's own initialization.
export async function createOpeningStock({ shopId, productId, quantity, notes, actingUser, req }) {
  const [shop, product] = await Promise.all([Shop.findById(shopId), Product.findById(productId)]);

  if (!shop) throw ApiError.notFound('Shop not found');
  if (!shop.isActive) throw ApiError.badRequest('Shop is not active');
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isActive) throw ApiError.badRequest('Product is not active');

  // Friendly pre-check for a clear error message; the partial unique index
  // on InventoryTransaction is the real, race-proof guard (see below).
  if (await hasOpeningStock(shopId, productId)) {
    throw ApiError.conflict('Opening stock has already been initialized for this shop/product');
  }

  const now = new Date();
  let transaction;
  try {
    transaction = await InventoryTransaction.create({
      shopId,
      productId,
      type: 'OPENING_STOCK',
      direction: 'IN',
      quantity,
      referenceType: 'OPENING_STOCK',
      referenceId: null,
      status: 'APPROVED',
      createdBy: actingUser._id,
      approvedBy: actingUser._id,
      approvedAt: now,
      notes,
    });
  } catch (err) {
    // Duplicate key on the partial unique index — another request won the
    // race between our pre-check and this insert.
    if (err.code === 11000) {
      throw ApiError.conflict('Opening stock has already been initialized for this shop/product');
    }
    throw err;
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId,
    action: AUDIT_ACTIONS.OPENING_STOCK_CREATED,
    entityType: 'InventoryTransaction',
    entityId: transaction._id,
    newValue: { quantity, productId },
  });

  const balance = await getInventoryBalance(shopId, productId);
  return { transaction, balance };
}
