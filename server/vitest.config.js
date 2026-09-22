import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    hookTimeout: 60000,
    testTimeout: 30000,
    // All test files share one real MongoDB test database, so they must not
    // run concurrently (a file's beforeEach would wipe another file's data).
    fileParallelism: false,
  },
});
