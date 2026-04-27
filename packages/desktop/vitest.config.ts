import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/global.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
      'tests/**/*.spec.{ts,tsx}',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src-tauri/**',
        '**/*.d.ts',
        '**/*.types.ts',
        'src/**/types.ts',
        'tests/**',
        'vite.config.ts',
        'vitest.config.ts',
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
})
