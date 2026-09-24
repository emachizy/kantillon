import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import mongoose from 'mongoose';

// This spawns the real script as a child process against a disposable,
// dedicated database — never the main kantillon_test database the rest of
// the suite uses (a separate mongoose.createConnection, not the shared
// singleton testDb.js manages), and NEVER the real production database.
const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(process.cwd(), 'src/scripts/bootstrapOwner.js');
const TEST_DB_URI = 'mongodb://127.0.0.1:27017/kantillon_bootstrap_script_test';

async function withConnection(fn) {
  const conn = await mongoose.createConnection(TEST_DB_URI).asPromise();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

async function dropTestDb() {
  await withConnection((conn) => conn.dropDatabase());
}

async function countUsers() {
  return withConnection((conn) => conn.collection('users').countDocuments({}));
}

function runBootstrap(envOverrides) {
  return execFileAsync('node', [SCRIPT_PATH], {
    env: { ...process.env, MONGO_URI: TEST_DB_URI, ...envOverrides },
  });
}

const VALID_ENV = {
  NODE_ENV: 'production',
  BOOTSTRAP_OWNER_NAME: 'Test Owner',
  BOOTSTRAP_OWNER_EMAIL: 'bootstrap-test@test.dev',
  BOOTSTRAP_OWNER_PASSWORD: 'BootstrapPass123!',
};

describe('bootstrap-owner script (against a disposable database)', () => {
  beforeEach(async () => {
    await dropTestDb();
  });

  afterAll(async () => {
    await dropTestDb();
  });

  it('creates an OWNER user in the target database', async () => {
    const { stdout } = await runBootstrap(VALID_ENV);
    expect(stdout).toContain('OWNER user created successfully');
    expect(await countUsers()).toBe(1);

    await withConnection(async (conn) => {
      const doc = await conn.collection('users').findOne({ email: VALID_ENV.BOOTSTRAP_OWNER_EMAIL });
      expect(doc.role).toBe('OWNER');
      expect(doc.isActive).toBe(true);
    });
  });

  it('hashes the password — never stores it in plaintext', async () => {
    await runBootstrap(VALID_ENV);
    await withConnection(async (conn) => {
      const doc = await conn.collection('users').findOne({ email: VALID_ENV.BOOTSTRAP_OWNER_EMAIL });
      expect(doc.passwordHash).toBeDefined();
      expect(doc.passwordHash).not.toBe(VALID_ENV.BOOTSTRAP_OWNER_PASSWORD);
      expect(doc.passwordHash.startsWith('$2')).toBe(true); // bcrypt hash prefix
    });
  });

  it('rejects a duplicate email and does not create a second user', async () => {
    await runBootstrap(VALID_ENV);
    await expect(runBootstrap(VALID_ENV)).rejects.toMatchObject({ code: 1 });
    expect(await countUsers()).toBe(1);
  });

  it('never wipes pre-existing data in the target database', async () => {
    await withConnection((conn) => conn.collection('shops').insertOne({ name: 'Pre-existing Shop', code: 'PRE-1' }));

    await runBootstrap(VALID_ENV);

    await withConnection(async (conn) => {
      const shop = await conn.collection('shops').findOne({ code: 'PRE-1' });
      expect(shop).not.toBeNull();
    });
  });

  it('accepts NODE_ENV=production (unlike the dev seed script, which refuses)', async () => {
    const { stdout } = await runBootstrap({ ...VALID_ENV, NODE_ENV: 'production' });
    expect(stdout).toContain('OWNER user created successfully');
  });

  it('reads all configuration from environment variables, not hardcoded values', async () => {
    const customEmail = 'another-owner@test.dev';
    await runBootstrap({ ...VALID_ENV, BOOTSTRAP_OWNER_EMAIL: customEmail });
    await withConnection(async (conn) => {
      const doc = await conn.collection('users').findOne({ email: customEmail });
      expect(doc).not.toBeNull();
    });
  });

  it('exits non-zero and creates nothing when required environment variables are missing', async () => {
    await expect(
      runBootstrap({ NODE_ENV: 'production', BOOTSTRAP_OWNER_EMAIL: 'incomplete@test.dev' })
    ).rejects.toMatchObject({ code: 1 });
    expect(await countUsers()).toBe(0);
  });

  it('disconnects cleanly (the process exits on its own without hanging)', async () => {
    // execFileAsync resolving/rejecting at all (rather than the test timing
    // out) already proves the child process's event loop drained — i.e.
    // disconnectDB() ran and nothing kept it alive.
    await expect(runBootstrap(VALID_ENV)).resolves.toBeDefined();
  });
});
