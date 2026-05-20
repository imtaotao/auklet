import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
  },
  styles: {
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
    dependencies: {
      '@demo/theme': {
        entry: '/style.css',
        themes: {
          light: '/themes/light.css',
          dark: '/themes/dark.css',
        },
      },
    },
  },
};
