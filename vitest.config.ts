import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/src/**/*.test.ts'],
    environment: 'node',
  },
});
