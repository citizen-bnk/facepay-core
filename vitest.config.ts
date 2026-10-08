import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { RATE_LIMIT_DISABLED: 'true', JWT_SECRET: 'test-secret-test-secret-test-secret-123456', NODE_ENV: 'test' },
  },
});
