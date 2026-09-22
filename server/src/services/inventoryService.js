import mongoose from 'mongoose';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Product } from '../models/Product.js';

// The one place official stock is computed. Only APPROVED transactions ever
// count — PENDING, REJECTED, and VOIDED must never move the number a caller
// sees. Nothing else in the codebase should sum InventoryTransaction rows
// directly; go through this service instead.

const NET_QUANTITY_EXPR = {
  $sum: {
    $cond: [{ $eq: ['$direction', 'IN'] }, '$quantity', { $multiply: ['$quantity', -1] }],
  },
};

export async function getInventoryBalance(shopId, productId) {
  const [result] = await InventoryTransaction.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        productId: new mongoose.Types.ObjectId(productId),
        status: 'APPROVED',
      },
    },
    { $group: { _id: null, balance: NET_QUANTITY_EXPR } },
  ]);

  return result?.balance ?? 0;
}

export async function hasOpeningStock(shopId, productId) {
  const existing = await InventoryTransaction.exists({
    shopId,
    productId,
    type: 'OPENING_STOCK',
  });
  return Boolean(existing);
}

// Opening stock is initialization and must be chronologically first — if
// any other ledger activity already exists for this shop/product (a stock
// receipt, a sale, anything), initializing opening stock now would silently
// misrepresent history. Used by openingStockService to reject that case.
export async function hasAnyNonOpeningStockActivity(shopId, productId) {
  const existing = await InventoryTransaction.exists({
    shopId,
    productId,
    type: { $ne: 'OPENING_STOCK' },
  });
  return Boolean(existing);
}

// The approved ledger balance as of the start of a given business date:
// every APPROVED transaction strictly before that date, PLUS — the one
// deliberate exception — an OPENING_STOCK transaction dated exactly that
// business date (so a shop initialized and given its first sale on the
// same day doesn't see a zero opening balance; see README "Opening stock
// calculation").
export async function getOpeningStockForBusinessDate(shopId, productId, businessDate) {
  const [result] = await InventoryTransaction.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        productId: new mongoose.Types.ObjectId(productId),
        status: 'APPROVED',
        $or: [
          { businessDate: { $lt: businessDate } },
          { businessDate, type: 'OPENING_STOCK' },
        ],
      },
    },
    { $group: { _id: null, balance: NET_QUANTITY_EXPR } },
  ]);

  return result?.balance ?? 0;
}

// Approved stock received *for a specific business date* — PENDING and
// REJECTED receipts never count, and only STOCK_RECEIPT/IN transactions
// count (an opening-stock or a sale dated the same day is not "received").
export async function getApprovedStockReceivedForBusinessDate(shopId, productId, businessDate) {
  const [result] = await InventoryTransaction.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        productId: new mongoose.Types.ObjectId(productId),
        status: 'APPROVED',
        type: 'STOCK_RECEIPT',
        direction: 'IN',
        businessDate,
      },
    },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);

  return result?.total ?? 0;
}

// Balances for every active product in a shop, in one aggregation query
// (not one query per product) plus one existence-check query for which
// products have already been through opening-stock initialization.
export async function getShopInventory(shopId) {
  const shopObjectId = new mongoose.Types.ObjectId(shopId);

  const [products, balanceRows, initializedRows] = await Promise.all([
    Product.find({ isActive: true }).sort({ name: 1 }),
    InventoryTransaction.aggregate([
      { $match: { shopId: shopObjectId, status: 'APPROVED' } },
      { $group: { _id: '$productId', balance: NET_QUANTITY_EXPR } },
    ]),
    InventoryTransaction.aggregate([
      { $match: { shopId: shopObjectId, type: 'OPENING_STOCK' } },
      { $group: { _id: '$productId' } },
    ]),
  ]);

  const balanceByProduct = new Map(balanceRows.map((row) => [row._id.toString(), row.balance]));
  const initializedProducts = new Set(initializedRows.map((row) => row._id.toString()));

  return products.map((product) => ({
    product: {
      id: product._id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
    },
    balance: balanceByProduct.get(product._id.toString()) ?? 0,
    initialized: initializedProducts.has(product._id.toString()),
  }));
}
