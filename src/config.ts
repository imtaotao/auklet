import type { CssDependencyGroup } from '#auklet/types';

export const aukletConfigFile = 'auklet.config.ts';

export const aukletDefaultCssDependencyConfig: CssDependencyGroup = {
  global: '/style.css',
  component: ['/pages/**.css', '/components/**.css'],
  themes: {
    dark: '/themes/dark.css',
    light: '/themes/light.css',
  },
};
