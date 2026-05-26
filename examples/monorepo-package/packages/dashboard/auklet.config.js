import { defineConfig } from 'auklet';

export const config = defineConfig({
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
  },
  styles: {
    dependencies: {
      '@demo/ui': {
        entry: '/style.css',
        components: '/components/**.css',
        themes: {
          light: '/themes/light.css',
          dark: '/themes/dark.css',
        },
      },
    },
  },
});
