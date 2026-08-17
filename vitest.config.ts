import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts', 'components/**/*.test.tsx', 'entrypoints/**/*.test.tsx'],
  },
});
