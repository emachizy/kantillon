import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createUser } from '../src/services/userService.js';
import { User } from '../src/models/User.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

const PASSWORD = 'CorrectHorse123!';

async function seedOwner() {
  return createUser({
    name: 'Test Owner',
    email: 'owner@test.dev',
    password: PASSWORD,
    role: ROLES.OWNER,
  });
}

describe('POST /api/auth/login', () => {
  it('succeeds with valid credentials and sets an httpOnly cookie', async () => {
    await seedOwner();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('owner@test.dev');

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith('kantillon_token=') && /HttpOnly/i.test(c))).toBe(
      true
    );
  });

  it('fails with invalid credentials', async () => {
    await seedOwner();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('never returns passwordHash', async () => {
    await seedOwner();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: PASSWORD });

    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a deactivated user even with correct credentials', async () => {
    const owner = await seedOwner();
    owner.isActive = false;
    await owner.save();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/auth/me', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns the current user for an authenticated request, without passwordHash', async () => {
    await seedOwner();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@test.dev', password: PASSWORD });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('owner@test.dev');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a previously valid session cookie once the user is deactivated', async () => {
    const owner = await seedOwner();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@test.dev', password: PASSWORD });

    await User.updateOne({ _id: owner._id }, { isActive: false });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/shops (unauthenticated)', () => {
  it('cannot access a protected endpoint without logging in', async () => {
    const res = await request(app).get('/api/shops');
    expect(res.status).toBe(401);
  });
});
