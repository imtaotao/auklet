import path from 'node:path';
import { expect } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { normalizeFileKey, toFsSpecifier } from '#auklet/utils';
import type { VirtualProject } from '../../fixtures/virtualProject';

export const appPackageRoot = 'packages/app-package';
export const uiPackageRoot = 'packages/ui-package';

export function createMonorepoGraph(fixture: VirtualProject) {
  return new ModuleStyleGraph({
    root: fixture.root,
    mode: 'monorepo',
  });
}

export function setupMonorepoPackages(fixture: VirtualProject) {
  fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  fixture.writeJson(path.join(appPackageRoot, 'package.json'), {
    name: '@scope/app',
  });
  fixture.writeJson(path.join(uiPackageRoot, 'package.json'), {
    name: '@scope/ui',
  });
  fixture.writeFile(
    path.join(uiPackageRoot, 'node_modules/katex/dist/katex.min.css'),
    '',
  );
}

export function packagePath(
  fixture: VirtualProject,
  packageRoot: string,
  relativePath: string,
) {
  return path.join(fixture.root, packageRoot, relativePath);
}

export function getKatexStylePath(fixture: VirtualProject) {
  return packagePath(
    fixture,
    uiPackageRoot,
    'node_modules/katex/dist/katex.min.css',
  );
}

export function getKatexStyleSpecifier(fixture: VirtualProject) {
  return toFsSpecifier(getKatexStylePath(fixture));
}

export function expectWatchFile(
  watchFiles: Array<string>,
  fixture: VirtualProject,
  packageRoot: string,
  relativePath: string,
) {
  expect(watchFiles).toContain(
    normalizeFileKey(packagePath(fixture, packageRoot, relativePath)),
  );
}

export function expectContentOrder(
  content: string,
  before: string,
  after: string,
) {
  expect(content.indexOf(before)).toBeLessThan(content.indexOf(after));
}
