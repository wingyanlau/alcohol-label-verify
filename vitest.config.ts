import { defineConfig } from 'vitest/config'

/**
 * Two suites, because they have completely different economics.
 *
 *   src/domain/**   pure functions — no model, no network, no platform.
 *                   Free, instant, exhaustively coverable. This is where the
 *                   compliance logic lives and where coverage is enforced.
 *
 *   src/*.ts        Worker and Durable Object code — needs the workers pool.
 *                   Covered by contract, not by line count.
 *
 * See test-plan.md §1: test effort follows testability, not code volume.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only the deterministic core carries a threshold. A global percentage
      // would be a weak metric — it rewards testing plumbing and says nothing
      // about whether the rules are right. The real gate is the requirements
      // matrix in test-plan.md §12.
      include: ['src/domain/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
})
