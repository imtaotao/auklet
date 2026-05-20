import type { ModuleStyleBuildConfig } from '#auklet/types';

export const moduleStyleBuildConfig: ModuleStyleBuildConfig = {
  styleExtensions: ['.css'],
  output: {
    styleDir: 'style',
    indexStyleFile: 'index.css',
    moduleStyleFile: 'module.css',
    externalStyleFile: 'external.css',
    outputFormats: ['es', 'lib'],
  },
};
