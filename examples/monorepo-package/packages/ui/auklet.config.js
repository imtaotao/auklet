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
      // Modules + plain css/less (Less copied as-is for tokens / reference).
      output: './src/shared/**/*.{module.css,module.less,css,less}',
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
