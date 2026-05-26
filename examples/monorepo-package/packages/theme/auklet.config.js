import { defineConfig } from 'auklet';

export const config = defineConfig({
  modules: true,
  styles: {
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
  },
});
