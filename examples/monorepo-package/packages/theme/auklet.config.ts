import type { AukletConfig } from 'auklet';

export const config: AukletConfig = {
  modules: true,
  styles: {
    themes: {
      light: './src/themes/light.css',
      dark: './src/themes/dark.css',
    },
  },
};
