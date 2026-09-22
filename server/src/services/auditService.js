import { AuditLog } from '../models/AuditLog.js';

// Only insert path for AuditLog in the whole codebase — there is no
// update/delete route for this collection, so every row written here is
// permanent.
//
// Failures are swallowed (logged, not thrown), by deliberate choice: a
// logging problem must never roll back or fail a real inventory action the
// owner/staff is actively waiting on. That choice has a real cost — a lost
// audit write for an already-committed inventory mutation is invisible to
// the API caller — so the failure is logged with a distinct, greppable tag
// and full context precisely so it is NOT silently ignored operationally
// (e.g. an alert can be wired to [AUDIT_WRITE_FAILED] in log aggregation).
//
// Production requirement: on a transaction-capable MongoDB deployment
// (replica set / mongos), the business mutation and its required audit
// record should be written atomically in the same session — e.g. by
// passing a session through to recordAudit and wrapping both the mutation
// and this insert in session.withTransaction(), the same pattern
// utils/transactionRunner.js already uses for stock receipt submission.
// That is not done here: on this project's standalone MongoDB, wrapping
// the mutation itself in a required-audit transaction would mean a lost
// audit write silently rolls the real inventory action back too — trading
// "audit loss is possible" for "the owner's approve/reject can mysteriously
// fail for reasons unrelated to the receipt itself", which is a worse
// failure mode for this phase's standalone environment. Swallow-and-log is
// the safer tradeoff until a replica set is available.
export async function recordAudit({
  req,
  userId,
  shopId = null,
  action,
  entityType,
  entityId = null,
  previousValue = null,
  newValue = null,
  reason = undefined,
}) {
  try {
    await AuditLog.create({
      userId,
      shopId,
      action,
      entityType,
      entityId,
      previousValue,
      newValue,
      reason,
      ipAddress: req?.ip,
      userAgent: req?.get?.('user-agent'),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[AUDIT_WRITE_FAILED]', {
      action,
      entityType,
      entityId,
      userId,
      shopId,
      error: err,
    });
  }
}
