import type { CssDependencyGroup, CssOptions } from '#auklet/types';

export const aukletConfigFile = 'auklet.config.ts';

export const aukletDefaultCssOptions = {
  sourceDir: 'src',
  outputDir: 'dist',
  themes: {},
} satisfies Required<Pick<CssOptions, 'sourceDir' | 'outputDir' | 'themes'>>;

export const aukletDefaultCssDependencyConfig: CssDependencyGroup = {
  global: '/style.css',
  component: ['/pages/**.css', '/components/**.css'],
  themes: {
    dark: '/themes/dark.css',
    light: '/themes/light.css',
  },
};
