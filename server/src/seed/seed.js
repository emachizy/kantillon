// Development seed data ONLY. Never run this against a production database —
// the credentials below are intentionally simple and publicly documented in
// the README for local development convenience.
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Shop } from '../models/Shop.js';
import { Product } from '../models/Product.js';
import { ShopPrice } from '../models/ShopPrice.js';
import { createUser } from '../services/userService.js';
import { ROLES } from '../utils/constants.js';

const DEV_PASSWORD = 'DevPass123!';

async function seed() {
  // Hard stop, not just a comment: this script wipes collections and inserts
  // well-known credentials, so it must never run against production by
  // accident (e.g. a bad NODE_ENV on a shared deploy box).
  if (env.nodeEnv === 'production') {
    console.error(
      'Refusing to run the development seed script with NODE_ENV=production. ' +
        'This would wipe data and insert publicly documented credentials.'
    );
    process.exit(1);
  }

  await connectDB();
  console.log(`Seeding database: ${env.mongoUri}`);

  await Promise.all([
    User.deleteMany({}),
    Shop.deleteMany({}),
    Product.deleteMany({}),
    ShopPrice.deleteMany({}),
  ]);

  const owner = await createUser({
    name: 'System Owner',
    email: 'owner@kantillon.dev',
    phone: '+254700000001',
    password: DEV_PASSWORD,
    role: ROLES.OWNER,
  });

  const product = await Product.create({
    name: 'Lafarge Cement',
    sku: 'LAF-50KG',
    unit: 'bag',
  });

  const [shopA, shopB, shopC] = await Shop.create([
    { name: 'Shop A', code: 'SHOP-A', address: '123 Industrial Road' },
    { name: 'Shop B', code: 'SHOP-B', address: '45 Market Street' },
    { name: 'Shop C', code: 'SHOP-C', address: '9 Highway Bypass' },
  ]);

  const manager = await createUser({
    name: 'Jane Manager',
    email: 'manager@kantillon.dev',
    phone: '+254700000002',
    password: DEV_PASSWORD,
    role: ROLES.MANAGER,
    shopIds: [shopA._id],
  });

  const salesperson = await createUser({
    name: 'Sam Salesperson',
    email: 'sales@kantillon.dev',
    phone: '+254700000003',
    password: DEV_PASSWORD,
    role: ROLES.SALESPERSON,
    shopIds: [shopA._id],
  });

  shopA.managerId = manager._id;
  await shopA.save();

  await ShopPrice.create([
    { shopId: shopA._id, productId: product._id, price: 750, changedBy: owner._id },
    { shopId: shopB._id, productId: product._id, price: 780, changedBy: owner._id },
    { shopId: shopC._id, productId: product._id, price: 760, changedBy: owner._id },
  ]);

  console.log('\nSeed complete. Development credentials (do NOT use in production):');
  console.table([
    { role: 'OWNER', email: owner.email, password: DEV_PASSWORD },
    { role: 'MANAGER (Shop A)', email: manager.email, password: DEV_PASSWORD },
    { role: 'SALESPERSON (Shop A)', email: salesperson.email, password: DEV_PASSWORD },
  ]);
  console.log(`Shops: ${shopA.code}, ${shopB.code}, ${shopC.code}`);

  await disconnectDB();
}

seed().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
