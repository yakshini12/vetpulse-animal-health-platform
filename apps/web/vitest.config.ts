import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Single fork: the dev machine has little free RAM; worker pools OOM there.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
