import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
  },
  styles: {
    dependencies: {
      '@demo/ui': {
        entry: '/style.css',
        components: '/components/**.css',
      },
    },
  },
};
