import { describe, it, expect } from 'vitest';
import { assertSafeTestDatabase, EXPECTED_TEST_DB_NAME } from './testDb.js';

// This suite tests the safety guard itself, in isolation from any real
// connection, so it can exercise both failure modes deterministically.
describe('assertSafeTestDatabase (fail-closed guard)', () => {
  it('passes when NODE_ENV is "test" and the db name matches exactly', () => {
    expect(() =>
      assertSafeTestDatabase({ nodeEnv: 'test', dbName: EXPECTED_TEST_DB_NAME })
    ).not.toThrow();
  });

  it('refuses to run when NODE_ENV is not "test", even if the db name is correct', () => {
    expect(() =>
      assertSafeTestDatabase({ nodeEnv: 'production', dbName: EXPECTED_TEST_DB_NAME })
    ).toThrow(/NODE_ENV/);
    expect(() =>
      assertSafeTestDatabase({ nodeEnv: 'development', dbName: EXPECTED_TEST_DB_NAME })
    ).toThrow(/NODE_ENV/);
  });

  it('refuses to run against kantillon_dev even when NODE_ENV is "test"', () => {
    expect(() => assertSafeTestDatabase({ nodeEnv: 'test', dbName: 'kantillon_dev' })).toThrow(
      /connected database/
    );
  });

  it('refuses to run against an unrecognized/production-looking database name', () => {
    expect(() =>
      assertSafeTestDatabase({ nodeEnv: 'test', dbName: 'kantillon_production' })
    ).toThrow(/connected database/);
  });

  it('refuses to run when no database is connected at all', () => {
    expect(() => assertSafeTestDatabase({ nodeEnv: 'test', dbName: undefined })).toThrow(
      /connected database/
    );
  });
});
