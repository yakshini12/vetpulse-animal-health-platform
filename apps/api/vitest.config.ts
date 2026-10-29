import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one PostgreSQL test database, so files run
    // sequentially. Each file resets the tables it needs.
    include: ['src/test/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    fileParallelism: false,
    testTimeout: 45000,
    hookTimeout: 120000,
  },
});
