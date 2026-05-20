import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: 'true',
    __TEST__: 'true',
    __VERSION__: `'unknown'`,
  },
  resolve: {
    conditions: ['source'],
  },
});
