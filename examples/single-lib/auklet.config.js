import { defineConfig } from 'auklet';

export const config = defineConfig({
  build: {
    formats: ['esm', 'cjs'],
  },
});
