import { StockReceipt } from '../models/StockReceipt.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../utils/constants.js';
import { recordAudit } from './auditService.js';
import { getInventoryBalance } from './inventoryService.js';
import { runWithOptionalTransaction } from '../utils/transactionRunner.js';

const RECEIPT_POPULATE = [
  { path: 'shopId', select: 'name code' },
  { path: 'productId', select: 'name sku unit' },
  { path: 'receivedBy', select: 'name role' },
  { path: 'approvedBy', select: 'name role' },
  { path: 'rejectedBy', select: 'name role' },
];

export async function submitStockReceipt({
  shopId,
  productId,
  quantity,
  deliveryReference,
  notes,
  actingUser,
  req,
}) {
  const [shop, product] = await Promise.all([Shop.findById(shopId), Product.findById(productId)]);

  if (!shop) throw ApiError.notFound('Shop not found');
  if (!shop.isActive) throw ApiError.badRequest('Shop is not active');
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isActive) throw ApiError.badRequest('Product is not active');

  const receivedAt = new Date();

  // The only multi-document create in Phase 2 — a receipt plus its linked
  // PENDING ledger row. No concurrent writer contends for these (they're
  // brand-new documents), so there's no double-processing race — but on
  // standalone MongoDB (no session/transaction), a crash or error between
  // the two writes can leave one half persisted without the other. Since
  // that would let an orphaned, unlinked PENDING receipt appear as a real
  // pending item, the catch block below compensates by deleting whatever
  // partially succeeded before surfacing the failure. When a real session
  // IS active (replica set / mongos), session.withTransaction() already
  // aborts everything on a thrown error, so no manual cleanup applies or is
  // needed in that branch. See utils/transactionRunner.js for why this
  // can't use a real transaction on this standalone MongoDB instance.
  const { receipt, transaction } = await runWithOptionalTransaction(async (session) => {
    let createdReceipt;
    let createdTransaction;
    try {
      [createdReceipt] = await StockReceipt.create(
        [
          {
            shopId,
            productId,
            quantity,
            deliveryReference,
            notes,
            receivedBy: actingUser._id,
            receivedAt,
            status: 'PENDING',
          },
        ],
        { session }
      );

      [createdTransaction] = await InventoryTransaction.create(
        [
          {
            shopId,
            productId,
            type: 'STOCK_RECEIPT',
            direction: 'IN',
            quantity,
            referenceType: 'STOCK_RECEIPT',
            referenceId: createdReceipt._id,
            status: 'PENDING',
            createdBy: actingUser._id,
            notes,
          },
        ],
        { session }
      );

      createdReceipt.inventoryTransactionId = createdTransaction._id;
      await createdReceipt.save({ session });

      return { receipt: createdReceipt, transaction: createdTransaction };
    } catch (err) {
      if (session) {
        // A real transaction is active — it will be aborted automatically
        // by session.withTransaction() on this thrown error, so nothing
        // above was committed. No manual compensation is possible or needed.
        throw err;
      }

      // No transaction is available on this standalone instance, so the
      // writes above were NOT atomic. Compensate by removing whatever
      // partially succeeded so no inconsistent document is ever left
      // queryable — e.g. a PENDING receipt with no linked ledger row, or a
      // ledger row referencing a receipt that doesn't exist.
      const cleanupTasks = [];
      if (createdReceipt) cleanupTasks.push(StockReceipt.deleteOne({ _id: createdReceipt._id }));
      if (createdTransaction) {
        cleanupTasks.push(InventoryTransaction.deleteOne({ _id: createdTransaction._id }));
      }
      const cleanupResults = cleanupTasks.length ? await Promise.allSettled(cleanupTasks) : [];
      const cleanupFailures = cleanupResults.filter((r) => r.status === 'rejected');

      // eslint-disable-next-line no-console
      console.error('[STOCK_RECEIPT_PARTIAL_FAILURE]', {
        shopId,
        productId,
        createdReceiptId: createdReceipt?._id,
        createdTransactionId: createdTransaction?._id,
        originalError: err,
        cleanupAttempted: cleanupTasks.length,
        cleanupFailures: cleanupFailures.length,
      });

      if (cleanupFailures.length) {
        // Best-effort compensation itself failed — this is the honest,
        // rare residual risk of no transactions on standalone MongoDB: an
        // orphaned document may remain. Surfaced loudly rather than hidden.
        throw ApiError.internal(
          'Failed to submit stock receipt, and cleanup of partially-created data also failed. ' +
            'This requires manual review — see server logs for STOCK_RECEIPT_PARTIAL_FAILURE.'
        );
      }

      throw ApiError.internal(
        'Failed to submit stock receipt consistently; no partial record was retained. Please try again.'
      );
    }
  });

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId,
    action: AUDIT_ACTIONS.STOCK_RECEIPT_SUBMITTED,
    entityType: 'StockReceipt',
    entityId: receipt._id,
    newValue: { quantity, productId, deliveryReference },
  });

  return { receipt, transaction };
}

export async function approveStockReceipt({ id, actingUser, req }) {
  const receipt = await StockReceipt.findById(id);
  if (!receipt) throw ApiError.notFound('Stock receipt not found');

  // Defense in depth: submitStockReceipt() now compensates (deletes) any
  // partially-created receipt, so this should never be reachable — but if
  // one ever slipped through (or pre-dates the fix), refuse to let an
  // unlinked receipt be silently "approved" with no ledger effect.
  if (!receipt.inventoryTransactionId) {
    // eslint-disable-next-line no-console
    console.error('[STOCK_RECEIPT_ORPHANED]', { receiptId: id, action: 'approve' });
    throw ApiError.internal('This stock receipt has no linked inventory transaction and cannot be approved');
  }

  const now = new Date();

  // Atomic, single-document conditional update — the ledger row is the
  // source of truth for "did this actually get approved", and MongoDB
  // guarantees exactly one concurrent request can win this update. See
  // utils/transactionRunner.js and README "Concurrency strategy" for why
  // this doesn't need a multi-document transaction to be correct.
  const transaction = await InventoryTransaction.findOneAndUpdate(
    { _id: receipt.inventoryTransactionId, status: 'PENDING' },
    { status: 'APPROVED', approvedBy: actingUser._id, approvedAt: now },
    { new: true }
  );

  if (!transaction) {
    const current = await StockReceipt.findById(id);
    throw ApiError.conflict(
      `Stock receipt is already ${current?.status || 'resolved'} and cannot be approved`
    );
  }

  const updatedReceipt = await StockReceipt.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { status: 'APPROVED', approvedBy: actingUser._id, approvedAt: now },
    { new: true }
  ).populate(RECEIPT_POPULATE);

  if (!updatedReceipt) {
    // Not a concurrency race — the ledger gate above already guarantees we
    // were the sole winner, so no other approve/reject call could have
    // touched this receipt concurrently. The only realistic cause is a
    // process crash between the two writes above (no transaction protects
    // them on this standalone instance). InventoryTransaction — the real
    // source of truth for stock — is already correctly APPROVED at this
    // point; only the receipt's displayed status would be lagging. We do
    // NOT attempt to auto-revert the ledger transaction back to PENDING
    // here: that would mutate a decision already made rather than clean up
    // a fresh insert (unlike the compensation in submitStockReceipt), and
    // could itself race with a legitimate concurrent read. This is
    // surfaced loudly for manual review instead.
    // eslint-disable-next-line no-console
    console.error('[STOCK_RECEIPT_STATE_DIVERGED]', {
      receiptId: id,
      transactionId: transaction._id,
      action: 'approve',
    });
    throw ApiError.internal('Inventory transaction and stock receipt state diverged');
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: updatedReceipt.shopId._id,
    action: AUDIT_ACTIONS.STOCK_RECEIPT_APPROVED,
    entityType: 'StockReceipt',
    entityId: updatedReceipt._id,
    previousValue: { status: 'PENDING' },
    newValue: { status: 'APPROVED' },
  });

  const balance = await getInventoryBalance(updatedReceipt.shopId._id, updatedReceipt.productId._id);
  return { receipt: updatedReceipt, balance };
}

export async function rejectStockReceipt({ id, reason, actingUser, req }) {
  const receipt = await StockReceipt.findById(id);
  if (!receipt) throw ApiError.notFound('Stock receipt not found');

  if (!receipt.inventoryTransactionId) {
    // eslint-disable-next-line no-console
    console.error('[STOCK_RECEIPT_ORPHANED]', { receiptId: id, action: 'reject' });
    throw ApiError.internal('This stock receipt has no linked inventory transaction and cannot be rejected');
  }

  const now = new Date();

  const transaction = await InventoryTransaction.findOneAndUpdate(
    { _id: receipt.inventoryTransactionId, status: 'PENDING' },
    { status: 'REJECTED' },
    { new: true }
  );

  if (!transaction) {
    const current = await StockReceipt.findById(id);
    throw ApiError.conflict(
      `Stock receipt is already ${current?.status || 'resolved'} and cannot be rejected`
    );
  }

  const updatedReceipt = await StockReceipt.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { status: 'REJECTED', rejectedBy: actingUser._id, rejectedAt: now, rejectionReason: reason },
    { new: true }
  ).populate(RECEIPT_POPULATE);

  if (!updatedReceipt) {
    // See the identical branch in approveStockReceipt for why no automatic
    // compensation is attempted here — same reasoning applies to rejection.
    // eslint-disable-next-line no-console
    console.error('[STOCK_RECEIPT_STATE_DIVERGED]', {
      receiptId: id,
      transactionId: transaction._id,
      action: 'reject',
    });
    throw ApiError.internal('Inventory transaction and stock receipt state diverged');
  }

  await recordAudit({
    req,
    userId: actingUser._id,
    shopId: updatedReceipt.shopId._id,
    action: AUDIT_ACTIONS.STOCK_RECEIPT_REJECTED,
    entityType: 'StockReceipt',
    entityId: updatedReceipt._id,
    previousValue: { status: 'PENDING' },
    newValue: { status: 'REJECTED' },
    reason,
  });

  return { receipt: updatedReceipt };
}

export async function listPendingStockReceipts() {
  return StockReceipt.find({ status: 'PENDING' }).sort({ createdAt: 1 }).populate(RECEIPT_POPULATE);
}

export async function listStockReceipts(filter) {
  return StockReceipt.find(filter).sort({ createdAt: -1 }).populate(RECEIPT_POPULATE);
}
