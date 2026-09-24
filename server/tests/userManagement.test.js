import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createTestUser, createTestShop, loginAgent, PASSWORD } from './factories.js';
import { User } from '../src/models/User.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

function staffPayload(overrides = {}) {
  return {
    name: 'Chinedu Okafor',
    email: 'chinedu@test.dev',
    role: 'SALESPERSON',
    shopIds: [],
    temporaryPassword: 'TempPass2026!',
    ...overrides,
  };
}

describe('POST /api/users — creation', () => {
  it('1. OWNER creates a salesperson', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const shop = await createTestShop();
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload({ shopIds: [shop._id.toString()] }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('SALESPERSON');
    expect(res.body.data.user.email).toBe('chinedu@test.dev');
  });

  it('2. OWNER creates a manager', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const shop = await createTestShop();
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent
      .post('/api/users')
      .send(staffPayload({ email: 'ada@test.dev', role: 'MANAGER', shopIds: [shop._id.toString()] }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('MANAGER');
  });

  it('3. OWNER creates an admin', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload({ email: 'admin@test.dev', role: 'ADMIN' }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('4. SALESPERSON cannot create users', async () => {
    await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev' });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.post('/api/users').send(staffPayload({ email: 'new@test.dev' }));
    expect(res.status).toBe(403);
  });

  it('5. MANAGER cannot create users', async () => {
    const manager = await createTestUser({ role: ROLES.MANAGER, email: 'manager@test.dev' });
    const agent = await loginAgent(app, manager.email);

    const res = await agent.post('/api/users').send(staffPayload({ email: 'new@test.dev' }));
    expect(res.status).toBe(403);
  });

  it('6. ADMIN cannot create users', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN, email: 'admin@test.dev' });
    const agent = await loginAgent(app, admin.email);

    const res = await agent.post('/api/users').send(staffPayload({ email: 'new@test.dev' }));
    expect(res.status).toBe(403);
  });

  it('7. unauthenticated cannot create users', async () => {
    const request = (await import('supertest')).default;
    const anonRes = await request(app).post('/api/users').send(staffPayload({ email: 'new@test.dev' }));
    expect(anonRes.status).toBe(401);
  });

  it('8. duplicate email rejected', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    await createTestUser({ role: ROLES.SALESPERSON, email: 'taken@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload({ email: 'taken@test.dev' }));
    expect(res.status).toBe(409);
  });

  it('9. invalid shop rejected', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent
      .post('/api/users')
      .send(staffPayload({ shopIds: ['650000000000000000000000'] }));
    expect(res.status).toBe(400);
  });

  it('10. password is hashed, never stored in plaintext', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload());
    expect(res.status).toBe(201);

    const stored = await User.findById(res.body.data.user._id ?? res.body.data.user.id).select('+passwordHash');
    expect(stored.passwordHash).not.toBe('TempPass2026!');
    expect(await stored.comparePassword('TempPass2026!')).toBe(true);
  });

  it('11. passwordHash not returned from create', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload());
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('12. a normal user cannot be created as OWNER', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post('/api/users').send(staffPayload({ role: 'OWNER' }));
    expect(res.status).toBe(400);
  });
});

describe('Shop access derived from shopIds', () => {
  it('13. a salesperson assigned to one shop can access that shop', async () => {
    const shopA = await createTestShop();
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get(`/api/inventory/shop/${shopA._id}`);
    expect(res.status).toBe(200);
  });

  it('14. a salesperson cannot access an unassigned shop', async () => {
    const shopA = await createTestShop();
    const shopB = await createTestShop();
    const sales = await createTestUser({ role: ROLES.SALESPERSON, email: 'sales@test.dev', shopIds: [shopA._id] });
    const agent = await loginAgent(app, sales.email);

    const res = await agent.get(`/api/inventory/shop/${shopB._id}`);
    expect(res.status).toBe(403);
  });

  it('15. a manager with two shops can access both', async () => {
    const shopA = await createTestShop();
    const shopB = await createTestShop();
    const manager = await createTestUser({
      role: ROLES.MANAGER,
      email: 'manager@test.dev',
      shopIds: [shopA._id, shopB._id],
    });
    const agent = await loginAgent(app, manager.email);

    const resA = await agent.get(`/api/inventory/shop/${shopA._id}`);
    const resB = await agent.get(`/api/inventory/shop/${shopB._id}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it('16. OWNER sees all shops regardless of shopIds', async () => {
    const shopA = await createTestShop();
    const shopB = await createTestShop();
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const agent = await loginAgent(app, owner.email);

    const resA = await agent.get(`/api/inventory/shop/${shopA._id}`);
    const resB = await agent.get(`/api/inventory/shop/${shopB._id}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });
});

describe('PATCH /api/users/:id — shop assignment updates', () => {
  it('17. OWNER updates a user\'s shop assignments', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const shopA = await createTestShop();
    const shopB = await createTestShop();
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev', shopIds: [shopA._id] });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.patch(`/api/users/${staff._id}`).send({ shopIds: [shopB._id.toString()] });
    expect(res.status).toBe(200);
    const ids = res.body.data.user.shopIds.map((s) => s._id ?? s);
    expect(ids).toEqual([shopB._id.toString()]);
  });

  it('18. a removed shop becomes inaccessible', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const shopA = await createTestShop();
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev', shopIds: [shopA._id] });
    const ownerAgent = await loginAgent(app, owner.email);
    const staffAgent = await loginAgent(app, staff.email);

    expect((await staffAgent.get(`/api/inventory/shop/${shopA._id}`)).status).toBe(200);

    await ownerAgent.patch(`/api/users/${staff._id}`).send({ shopIds: [] });

    expect((await staffAgent.get(`/api/inventory/shop/${shopA._id}`)).status).toBe(403);
  });

  it('19. an added shop becomes accessible', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const shopA = await createTestShop();
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev', shopIds: [] });
    const ownerAgent = await loginAgent(app, owner.email);
    const staffAgent = await loginAgent(app, staff.email);

    expect((await staffAgent.get(`/api/inventory/shop/${shopA._id}`)).status).toBe(403);

    await ownerAgent.patch(`/api/users/${staff._id}`).send({ shopIds: [shopA._id.toString()] });

    expect((await staffAgent.get(`/api/inventory/shop/${shopA._id}`)).status).toBe(200);
  });
});

describe('Deactivate / reactivate', () => {
  it('20. OWNER deactivates a user', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post(`/api/users/${staff._id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);
  });

  it('21. a deactivated user cannot log in', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    await ownerAgent.post(`/api/users/${staff._id}/deactivate`);

    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/auth/login').send({ email: staff.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('22. OWNER reactivates a user', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    await ownerAgent.post(`/api/users/${staff._id}/deactivate`);

    const res = await ownerAgent.post(`/api/users/${staff._id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(true);
  });

  it('23. the user can log in again after reactivation', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    await ownerAgent.post(`/api/users/${staff._id}/deactivate`);
    await ownerAgent.post(`/api/users/${staff._id}/reactivate`);

    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/auth/login').send({ email: staff.email, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/users/:id/reset-password', () => {
  it('24. OWNER resets a staff password', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent
      .post(`/api/users/${staff._id}/reset-password`)
      .send({ newTemporaryPassword: 'BrandNew123!' });
    expect(res.status).toBe(200);
  });

  it('25. the old password fails after reset', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    await ownerAgent.post(`/api/users/${staff._id}/reset-password`).send({ newTemporaryPassword: 'BrandNew123!' });

    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/auth/login').send({ email: staff.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('26. the new password succeeds after reset', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const staff = await createTestUser({ role: ROLES.SALESPERSON, email: 'staff@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    await ownerAgent.post(`/api/users/${staff._id}/reset-password`).send({ newTemporaryPassword: 'BrandNew123!' });

    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'BrandNew123!' });
    expect(res.status).toBe(200);
  });
});

describe('OWNER self-protection', () => {
  it('27. OWNER cannot deactivate self through the staff-management endpoint', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const res = await ownerAgent.post(`/api/users/${owner._id}/deactivate`);
    expect(res.status).toBe(403);
  });

  it('28. OWNER cannot demote self through the staff-management endpoint', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    // "MANAGER" alone passes request validation (it's a normally-assignable
    // role) — the 403 must come from the service-layer "target is OWNER"
    // guard, not from schema validation.
    const res = await ownerAgent.patch(`/api/users/${owner._id}`).send({ role: 'MANAGER' });
    expect(res.status).toBe(403);

    const stillOwner = await User.findById(owner._id);
    expect(stillOwner.role).toBe('OWNER');
  });
});

describe('Never exposes passwordHash', () => {
  it('29. list/detail/create/update responses never include passwordHash', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);
    const createRes = await ownerAgent.post('/api/users').send(staffPayload());
    const userId = createRes.body.data.user._id ?? createRes.body.data.user.id;

    const listRes = await ownerAgent.get('/api/users');
    const detailRes = await ownerAgent.get(`/api/users/${userId}`);
    const updateRes = await ownerAgent.patch(`/api/users/${userId}`).send({ name: 'Updated Name' });

    expect(createRes.body.data.user.passwordHash).toBeUndefined();
    expect(listRes.body.data.users.some((u) => u.passwordHash)).toBe(false);
    expect(detailRes.body.data.user.passwordHash).toBeUndefined();
    expect(updateRes.body.data.user.passwordHash).toBeUndefined();
  });
});

describe('Audit logging', () => {
  it('30. user-management operations create audit log entries', async () => {
    const owner = await createTestUser({ role: ROLES.OWNER, email: 'owner@test.dev' });
    const ownerAgent = await loginAgent(app, owner.email);

    const createRes = await ownerAgent.post('/api/users').send(staffPayload());
    const userId = createRes.body.data.user._id ?? createRes.body.data.user.id;
    await ownerAgent.patch(`/api/users/${userId}`).send({ name: 'Renamed' });
    await ownerAgent.post(`/api/users/${userId}/deactivate`);
    await ownerAgent.post(`/api/users/${userId}/reactivate`);
    await ownerAgent.post(`/api/users/${userId}/reset-password`).send({ newTemporaryPassword: 'AnotherOne123!' });

    const actions = (await AuditLog.find({ entityId: userId })).map((a) => a.action);
    expect(actions).toContain('USER_CREATED');
    expect(actions).toContain('USER_UPDATED');
    expect(actions).toContain('USER_DEACTIVATED');
    expect(actions).toContain('USER_REACTIVATED');
    expect(actions).toContain('USER_PASSWORD_RESET');
  });
});
