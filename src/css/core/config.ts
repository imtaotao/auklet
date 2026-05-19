import type { ModuleCssBuildConfig } from '#auklet/types';

const CSS_EXTENSION = '.css';

export const moduleCssBuildConfig: ModuleCssBuildConfig = {
  output: {
    styleDir: 'style',
    indexCssFile: 'index.css',
    moduleCssFile: 'module.css',
    externalCssFile: 'external.css',
    outputFormats: ['es', 'lib'],
  },
  styleExtensions: [CSS_EXTENSION],
};
