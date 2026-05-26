import path from 'node:path';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import {
  type VirtualProject,
  createVirtualProject,
} from '../fixtures/virtualProject';

export function createE2eProject() {
  return createVirtualProject('auklet-e2e-');
}

export async function buildPackageStyles(
  packageRoot: string,
  aukletConfig: Record<string, unknown>,
) {
  await new ModuleStyleBuilder({
    packageRoot,
    aukletConfig,
  }).build();
}

export function writeComponentPackage(
  project: VirtualProject,
  packageRoot: string,
  packageName: string,
) {
  project.writeJson(path.join(packageRoot, 'package.json'), {
    name: packageName,
  });
  project.writeFile(
    path.join(packageRoot, 'auklet.config.js'),
    `
      export const config = {
        source: 'src',
        output: 'dist',
        modules: true,
      };
    `,
  );
  project.writeFile(
    path.join(packageRoot, 'src/components/Button/index.tsx'),
    'export function Button() { return null; }',
  );
  project.writeFile(
    path.join(packageRoot, 'src/components/Button/index.css'),
    '.button {}',
  );
  project.writeFile(path.join(packageRoot, 'src/index.css'), '.root {}');
}

export function writeMonorepoWorkspace(project: VirtualProject) {
  project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
}
