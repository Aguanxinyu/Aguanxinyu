import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'functions/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80
      }
    }
  }
});
