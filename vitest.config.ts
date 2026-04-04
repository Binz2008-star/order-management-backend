/// <reference types="vitest" />

export default {
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.ts'],
    fileParallelism: false, // Run tests sequentially for proper DB isolation
    testTimeout: 20000,
  },
}
