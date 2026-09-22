import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { createUser } from '../src/services/userService.js';
import { Shop } from '../src/models/Shop.js';
import { ROLES } from '../src/utils/constants.js';

const app = createApp();
const PASSWORD = 'CorrectHorse123!';

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function loginAs(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  return agent;
}

describe('shop authorization', () => {
  it('OWNER can retrieve all shops', async () => {
    const [shopA, shopB] = await Shop.create([
      { name: 'Shop A', code: 'SA' },
      { name: 'Shop B', code: 'SB' },
    ]);
    await createUser({ name: 'Owner', email: 'owner@test.dev', password: PASSWORD, role: ROLES.OWNER });

    const agent = await loginAs('owner@test.dev');
    const res = await agent.get('/api/shops');

    expect(res.status).toBe(200);
    const codes = res.body.data.shops.map((s) => s.code).sort();
    expect(codes).toEqual([shopA.code, shopB.code].sort());
  });

  it('a salesperson only sees shops they are assigned to', async () => {
    const [shopA, shopB] = await Shop.create([
      { name: 'Shop A', code: 'SA' },
      { name: 'Shop B', code: 'SB' },
    ]);
    await createUser({
      name: 'Sales',
      email: 'sales@test.dev',
      password: PASSWORD,
      role: ROLES.SALESPERSON,
      shopIds: [shopA._id],
    });

    const agent = await loginAs('sales@test.dev');
    const res = await agent.get('/api/shops');

    expect(res.status).toBe(200);
    expect(res.body.data.shops).toHaveLength(1);
    expect(res.body.data.shops[0].code).toBe(shopA.code);
    expect(res.body.data.shops.some((s) => s.code === shopB.code)).toBe(false);
  });
});
