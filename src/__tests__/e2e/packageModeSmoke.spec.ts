import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { collectStyleImports } from '../fixtures/styleStructure';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('package mode smoke', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-package-mode-');
  });

  afterEach(() => {
    project.cleanup();
  });

  const buildPackageStyles = async (
    packageRoot: string,
    aukletConfig: Record<string, unknown>,
  ) => {
    await new ModuleStyleBuilder({
      packageRoot,
      aukletConfig,
    }).build();
  };

  const writeConfig = (packageRoot: string, source = 'src') => {
    project.writeFile(
      path.join(packageRoot, 'auklet.config.ts'),
      `
        export const config = {
          source: '${source}',
          output: 'dist',
          modules: true,
        };
      `,
    );
  };

  const writeComponentPackage = (packageRoot: string, packageName: string) => {
    project.writeJson(path.join(packageRoot, 'package.json'), {
      name: packageName,
    });
    writeConfig(packageRoot);
    project.writeFile(
      path.join(packageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    project.writeFile(
      path.join(packageRoot, 'src/components/Button/index.css'),
      '.button {}',
    );
    project.writeFile(path.join(packageRoot, 'src/index.css'), '.root {}');
  };

  test('supports monorepo component packages', async () => {
    project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    writeComponentPackage('packages/ui', '@scope/ui');

    await buildPackageStyles(project.resolve('packages/ui'), {
      source: 'src',
      output: 'dist',
      modules: true,
    });

    expect(
      project.exists('packages/ui/dist/es/components/Button/style/index.css'),
    ).toBe(true);
    expect(
      collectStyleImports(
        project.readFile('packages/ui/dist/es/style/index.css'),
      ),
    ).toEqual(['./module.css']);

    const graph = new ModuleStyleGraph({
      root: project.root,
      mode: 'monorepo',
    });
    const result = await graph.createPackageStyleCode({
      packageName: '@scope/ui',
      stylePath: 'components/Button.css',
    });

    expect(result.code).toContain('.button {}');
  });

  test('supports monorepo lib packages without style output', async () => {
    project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    project.writeJson('packages/math/package.json', { name: '@scope/math' });
    project.writeFile('packages/math/src/index.ts', 'export const value = 1;');

    await buildPackageStyles(project.resolve('packages/math'), {
      source: 'src',
      output: 'dist',
    });

    expect(project.exists('packages/math/dist/index.css')).toBe(false);
  });

  test('supports single component packages', async () => {
    writeComponentPackage('', '@scope/single');

    await buildPackageStyles(project.root, {
      source: 'src',
      output: 'dist',
      modules: true,
    });

    expect(project.exists('dist/es/components/Button/style/index.css')).toBe(
      true,
    );

    const graph = new ModuleStyleGraph({
      root: project.root,
    });
    const result = await graph.createPackageStyleCode({
      packageName: '@scope/single',
      stylePath: 'style.css',
    });

    expect(result.code).toContain('.button {}');
    expect(result.code).toContain('.root {}');
  });

  test('supports single lib packages without style output', async () => {
    project.writePackageJson({ name: '@scope/single-lib' });
    project.writeFile('src/index.ts', 'export const value = 1;');

    await buildPackageStyles(project.root, {
      source: 'src',
      output: 'dist',
    });

    expect(project.exists('dist/index.css')).toBe(false);
  });
});
