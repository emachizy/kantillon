import mongoose from 'mongoose';

// The dev/local MongoDB here is a standalone instance (confirmed via
// rs.status() -> "not running with --replSet"), and standalone MongoDB
// cannot run multi-document transactions. We do NOT fake atomicity by
// pretending otherwise. Instead: try a real session transaction, and if
// MongoDB reports transactions aren't supported, fall back to plain
// sequential writes with no transactional guarantee. The result is cached
// per process so we only pay the failed-attempt cost once. Deployed against
// a replica set or mongos, this same code automatically gets real
// transactions with no changes required.
//
// This is only appropriate for a multi-document CREATE with no concurrent
// contention (see services/stockReceiptService.js). Approve/reject use a
// different strategy — a single-document atomic conditional update — that
// gives a real correctness guarantee without needing a replica set at all.
let transactionsSupported = null;

function isUnsupportedTransactionError(err) {
  return (
    err?.code === 20 || // IllegalOperation
    /Transaction numbers are only allowed on a replica set|transactions are not supported/i.test(
      err?.message || ''
    )
  );
}

export async function runWithOptionalTransaction(work) {
  if (transactionsSupported === false) {
    return work(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (transactionsSupported === null && isUnsupportedTransactionError(err)) {
      transactionsSupported = false;
      // eslint-disable-next-line no-console
      console.warn(
        'MongoDB transactions are not supported by this deployment (standalone instance) — ' +
          'falling back to sequential non-transactional writes for multi-document creates.'
      );
      // Safe to retry work() from scratch here: MongoDB rejects the
      // transaction on the very first command that uses this session (the
      // "transaction numbers are only allowed on a replica set" error is a
      // handshake failure, not a mid-transaction one), so nothing from the
      // failed attempt was ever persisted. This retry cannot produce a
      // duplicate write.
      return work(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
