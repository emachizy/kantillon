// One-time bootstrap: creates the FIRST OWNER user directly against
// whatever database MONGO_URI points to. Unlike src/seed/seed.js, this is
// explicitly meant to run against production — it never wipes any
// collection and never inserts hardcoded credentials; it reads everything
// from environment variables you provide at run time, so no real password
// is ever committed to the repo.
//
// Why this exists: seed.js refuses to run when NODE_ENV=production (by
// design — it wipes data and inserts publicly-documented dev credentials),
// so a fresh production database has no way to get its first user without
// a separate, safe script. This is that script.
//
// Usage (from the server/ directory), against your PRODUCTION database:
//
//   MONGO_URI="<your production Mongo connection string>" \
//   BOOTSTRAP_OWNER_NAME="Jane Doe" \
//   BOOTSTRAP_OWNER_EMAIL="jane@example.com" \
//   BOOTSTRAP_OWNER_PASSWORD="<a strong password, 8+ characters>" \
//   node src/scripts/bootstrapOwner.js
//
// BOOTSTRAP_OWNER_PHONE is optional. Run this once per environment — it's
// safe to re-run by accident, since userService.createUser already refuses
// to create a second user with the same email (it will fail loudly with a
// clear error instead of creating a duplicate or overwriting anything).
//
// Do NOT put real credentials in a shell history you share or a committed
// file — prefer an untracked, local-only .env file or pasting them
// directly into an interactive shell.
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { createUser } from '../services/userService.js';
import { createUserSchema } from '../validators/user.validators.js';
import { ROLES } from '../utils/constants.js';

async function bootstrapOwner() {
  const name = process.env.BOOTSTRAP_OWNER_NAME;
  const email = process.env.BOOTSTRAP_OWNER_EMAIL;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const phone = process.env.BOOTSTRAP_OWNER_PHONE || undefined;

  if (!name || !email || !password) {
    console.error(
      'Missing required environment variables. Set BOOTSTRAP_OWNER_NAME, ' +
        'BOOTSTRAP_OWNER_EMAIL, and BOOTSTRAP_OWNER_PASSWORD before running this script.'
    );
    process.exitCode = 1;
    return;
  }

  // Same validation an admin-created-user API would apply (role is fixed
  // to OWNER here — this script's only job is bootstrapping the first
  // owner, never an arbitrary account).
  const parsed = createUserSchema.safeParse({ name, email, phone, password, role: ROLES.OWNER });
  if (!parsed.success) {
    console.error('Invalid input:', parsed.error.flatten().fieldErrors);
    process.exitCode = 1;
    return;
  }

  await connectDB();
  console.log(`Connected to: ${env.mongoUri}`);

  try {
    const existingCount = await User.countDocuments({});
    console.log(`This database currently has ${existingCount} user(s).`);

    const user = await createUser(parsed.data);
    console.log('\nOWNER user created successfully:');
    console.log(`  name:  ${user.name}`);
    console.log(`  email: ${user.email}`);
    console.log(`  role:  ${user.role}`);
    console.log('\nYou can now log in with this email and the password you provided.');
  } catch (err) {
    console.error('Failed to create owner user:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}

bootstrapOwner();
