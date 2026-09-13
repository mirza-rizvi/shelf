import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest({
    // The WXT Vitest adapter resolves dev-server config even though tests do
    // not start that server. Pinning a strict test-only port avoids a flaky
    // localhost port scan in constrained CI and agent environments.
    dev: { server: { host: '127.0.0.1', port: 3000, strictPort: true } },
  })],
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts', 'components/**/*.test.tsx', 'entrypoints/**/*.test.tsx'],
  },
});
