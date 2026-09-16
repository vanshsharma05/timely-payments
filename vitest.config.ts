import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Unit and regression tests. They run the pure domain rules (types.ts, the
 * sheet import, the row mappers) and the edit dialog against synthetic data
 * only — nothing here signs in to Supabase or reads a sheet. The browser
 * suites in scripts/tests/ are a separate thing and are not picked up here.
 *
 * Tests run in node; a file that renders components declares
 * `// @vitest-environment jsdom` at its top.
 */
export default defineConfig({
    plugins: [react()],
    test: {
        include: ['tests/**/*.test.{ts,tsx}'],
        environment: 'node',
    },
});
