import mongoose from 'mongoose';

// Tests run against a real local MongoDB instance (a dedicated test
// database, never the dev database) rather than a mocked/in-memory one —
// see the feedback logged for this project on why ledger/authorization
// logic is tested against real Mongo behavior.
//
// Because these tests run destructive operations (deleteMany, dropDatabase),
// every one of those operations is gated by assertSafeTestDatabase() below,
// which fails closed: it throws unless BOTH (a) NODE_ENV is exactly "test"
// and (b) the actually-connected database name is exactly
// EXPECTED_TEST_DB_NAME. This is checked against the live connection, not
// against the configured URI string, so a typo'd or overridden
// MONGO_TEST_URI can't silently point cleanup at kantillon_dev or a
// production database.
export const EXPECTED_TEST_DB_NAME = 'kantillon_test';

const TEST_URI = process.env.MONGO_TEST_URI || `mongodb://127.0.0.1:27017/${EXPECTED_TEST_DB_NAME}`;

// Accepts explicit overrides (used by tests to exercise both failure modes
// without needing a second real connection); production code paths below
// call it with no arguments, which reads the real environment/connection.
export function assertSafeTestDatabase({
  nodeEnv = process.env.NODE_ENV,
  dbName = mongoose.connection?.db?.databaseName,
} = {}) {
  if (nodeEnv !== 'test') {
    throw new Error(
      `Refusing destructive test-database operation: NODE_ENV is "${nodeEnv}", expected "test". ` +
        'Run tests via "npm test" (which sets NODE_ENV=test), never against a dev/production environment.'
    );
  }

  if (dbName !== EXPECTED_TEST_DB_NAME) {
    throw new Error(
      `Refusing destructive test-database operation: connected database is "${dbName}", ` +
        `expected "${EXPECTED_TEST_DB_NAME}". Check MONGO_TEST_URI — it must never point at ` +
        'kantillon_dev or any production database.'
    );
  }
}

export async function startTestDb() {
  await mongoose.connect(TEST_URI);
  // Fail fast at setup, before any test gets a chance to run against the
  // wrong database.
  assertSafeTestDatabase();
}

export async function stopTestDb() {
  assertSafeTestDatabase();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearTestDb() {
  assertSafeTestDatabase();
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
