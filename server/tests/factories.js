import request from 'supertest';
import { createUser } from '../src/services/userService.js';
import { Shop } from '../src/models/Shop.js';
import { Product } from '../src/models/Product.js';

// Shared fixture helpers for Phase 2 test files. Not a test file itself
// (no describe/it), so vitest won't try to run it.
export const PASSWORD = 'CorrectHorse123!';

let counter = 0;
function unique(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function createTestUser({ role, email, shopIds = [], name } = {}) {
  return createUser({
    name: name || `Test ${role}`,
    email: email || `${unique('user')}@test.dev`,
    password: PASSWORD,
    role,
    shopIds,
  });
}

export async function createTestShop(overrides = {}) {
  return Shop.create({
    name: overrides.name || 'Test Shop',
    code: overrides.code || unique('SHOP-').toUpperCase(),
    isActive: overrides.isActive ?? true,
  });
}

export async function createTestProduct(overrides = {}) {
  return Product.create({
    name: overrides.name || 'Lafarge Cement',
    sku: overrides.sku || unique('SKU-').toUpperCase(),
    unit: overrides.unit || 'bag',
    isActive: overrides.isActive ?? true,
  });
}

export async function loginAgent(app, email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
