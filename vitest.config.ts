import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['services/*/src/**/*.test.ts', 'shared/**/*.test.ts', 'frontend/web/src/**/*.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', '**/*.d.ts'],
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['services/*/src/**/*.ts'],
            exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.d.ts'],
        },
        reporters: ['verbose'],
        testTimeout: 10000,
    },
});
