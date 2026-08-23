import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
  },
  resolve: {
    alias: {
      '@crypto-signal/shared': alias('shared'),
      '@crypto-signal/market-data': alias('market-data'),
      '@crypto-signal/indicators': alias('indicators'),
      '@crypto-signal/signal-engine': alias('signal-engine'),
      '@crypto-signal/health-engine': alias('health-engine'),
      '@crypto-signal/db': alias('db'),
    },
  },
});
