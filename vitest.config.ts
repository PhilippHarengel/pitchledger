import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // run.ts is the CLI entry (top-level await, git/network side effects) —
      // exercised by the workflow's manual dispatch, not unit tests.
      exclude: ['src/run.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
