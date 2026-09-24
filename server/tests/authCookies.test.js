import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createUser } from '../src/services/userService.js';
import { ROLES } from '../src/utils/constants.js';
import { getAuthCookieOptions } from '../src/utils/cookies.js';

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

// The production/development split is driven by an explicit parameter
// (defaulting to the real environment) so both configurations can be
// verified directly, without needing a second server process running
// under NODE_ENV=production.
describe('getAuthCookieOptions', () => {
  it('production: httpOnly, secure, and sameSite=none', () => {
    const options = getAuthCookieOptions(true);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('none');
    expect(options.path).toBe('/');
  });

  it('development: not secure and sameSite=lax', () => {
    const options = getAuthCookieOptions(false);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });

  it('preserves the 7-day maxAge in both configurations', () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(getAuthCookieOptions(true).maxAge).toBe(sevenDaysMs);
    expect(getAuthCookieOptions(false).maxAge).toBe(sevenDaysMs);
  });
});

describe('login/logout cookie attributes stay in sync', () => {
  it('logout clears the cookie with the same httpOnly/path/name as login set it with', async () => {
    await seedOwner();
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: PASSWORD });
    const loginCookie = loginRes.headers['set-cookie'].find((c) =>
      c.startsWith('kantillon_token=')
    );
    expect(loginCookie).toBeDefined();
    expect(loginCookie).toMatch(/HttpOnly/i);
    expect(loginCookie).toMatch(/Path=\//i);

    const logoutRes = await agent.post('/api/auth/logout');
    const logoutCookie = logoutRes.headers['set-cookie'].find((c) =>
      c.startsWith('kantillon_token=')
    );
    expect(logoutCookie).toBeDefined();
    expect(logoutCookie).toMatch(/HttpOnly/i);
    expect(logoutCookie).toMatch(/Path=\//i);

    // Same SameSite value on both — login and logout share one helper
    // (getAuthCookieOptions), so they cannot drift apart.
    const sameSiteOf = (cookie) => /SameSite=(\w+)/i.exec(cookie)?.[1]?.toLowerCase();
    expect(sameSiteOf(logoutCookie)).toBe(sameSiteOf(loginCookie));

    // The cleared cookie is expired / empty, so the agent no longer
    // authenticates on the next request.
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });
});

describe('GET /api/auth/me still requires a valid cookie', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the user for a request carrying a valid login cookie', async () => {
    await seedOwner();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@test.dev', password: PASSWORD });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('owner@test.dev');
  });
});
