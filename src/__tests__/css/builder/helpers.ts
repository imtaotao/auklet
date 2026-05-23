import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import type { AukletConfig } from '#auklet/types';
import type { VirtualProject } from '../../fixtures/virtualProject';

export const baseConfig = {
  source: 'source',
  output: 'output',
} satisfies AukletConfig;

export const moduleConfig = {
  ...baseConfig,
  modules: true,
} satisfies AukletConfig;

export function createBuilder(
  fixture: VirtualProject,
  aukletConfig: AukletConfig,
) {
  return new ModuleStyleBuilder({
    packageRoot: fixture.root,
    aukletConfig,
  });
}

export function writePackageImports(fixture: VirtualProject) {
  fixture.writePackageJson({
    name: 'fixture-package',
    imports: {
      '#fixture/*': './source/*.js',
    },
  });
}
