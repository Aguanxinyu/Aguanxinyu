import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.ts',
        'functions/*/src/**/*.ts',
        'miniprogram/stores/todo-store.ts'
      ],
      exclude: [
        '**/index.ts',
        '**/*.d.ts',
        // Process bootstrap and the Postgres adapter are validated by gated
        // integration tests (`PG_TEST_DATABASE_URL`) rather than unit coverage.
        'packages/backend/src/server.ts',
        'packages/backend/src/postgres-database.ts'
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
        'packages/domain/src/recurrence.ts': {
          branches: 90
        },
        'packages/domain/src/reminder.ts': {
          branches: 90
        }
      }
    }
  }
});
