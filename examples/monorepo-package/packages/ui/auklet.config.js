import { defineConfig } from 'auklet';

export const config = defineConfig({
  modules: true,
  build: {
    formats: ['esm', 'cjs'],
  },
  styles: {
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
    shared: {
      output: './src/shared/**/*.module.{less,css}',
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
});
