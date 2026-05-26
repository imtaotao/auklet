import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { MonorepoPackageSource } from '#auklet/css/vite/moduleGraph/packageSource/monorepo';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { setupMonorepoPackages } from './helpers';

describe('ModuleStyleGraph source boundaries', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-');
    setupMonorepoPackages(fixture);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('normalizes slash styles for workspace source graph checks and watch roots', async () => {
    const source = new MonorepoPackageSource({
      root: 'C:\\repo\\workspace',
      styleExtensions: ['.css'],
      readWorkspacePackages: () => [
        {
          name: '@scope/app',
          path: 'C:\\repo\\workspace\\packages\\app-package',
        },
        {
          name: '@scope/shared',
          path: 'C:/repo/workspace/packages/shared',
        },
      ],
    });

    const sourceGraphFiles = [
      'C:\\repo\\workspace\\packages\\app-package\\src\\pages\\Blog\\index.css',
      'C:/repo/workspace/packages/app-package/src/pages/Blog/index.tsx',
      'C:\\repo\\workspace\\packages\\shared\\src\\index.css',
    ];

    for (const file of sourceGraphFiles) {
      expect(source.isSourceGraphFile(file)).toBe(true);
    }
    expect(
      source.isSourceGraphFile(
        'C:/repo/workspace/packages/app-package/src/pages/Blog/data.ts',
      ),
    ).toBe(false);

    expect(await source.getWatchRoots()).toEqual([
      'C:/repo/workspace/packages/app-package/src',
      'C:/repo/workspace/packages/app-package/auklet.config.js',
      'C:/repo/workspace/packages/app-package/auklet.config.mjs',
      'C:/repo/workspace/packages/shared/src',
      'C:/repo/workspace/packages/shared/auklet.config.js',
      'C:/repo/workspace/packages/shared/auklet.config.mjs',
    ]);
  });

  test('uses package mode by default', async () => {
    fixture.writeJson('package.json', { name: '@scope/single' });
    fixture.writeFile(
      'auklet.config.js',
      `
        export const config = {
          source: 'source',
          output: 'dist',
        };
      `,
    );
    fixture.writeFile('source/index.css', '.single { color: red; }');

    const graph = new ModuleStyleGraph({
      root: fixture.root,
    });

    expect(graph.getPackageNames()).toEqual(['@scope/single']);
    expect(await graph.getWatchRoots()).toEqual([
      path.join(fixture.root, 'source'),
      path.join(fixture.root, 'auklet.config.js'),
      path.join(fixture.root, 'auklet.config.mjs'),
    ]);

    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/single/style.css')!,
    );

    expect(result.code).toContain('.single { color: red; }');
  });

  test('uses .mjs config files as virtual CSS watch dependencies', async () => {
    fixture.writeJson('package.json', { name: '@scope/single' });
    fixture.writeFile(
      'auklet.config.mjs',
      `
        export const config = {
          source: 'source',
          output: 'dist',
        };
      `,
    );
    fixture.writeFile('source/index.css', '.single { color: red; }');
    expect(fixture.exists('auklet.config.js')).toBe(false);

    const graph = new ModuleStyleGraph({
      root: fixture.root,
    });
    const result = await graph.createPackageStyleCode(
      graph.parsePackageStyleId('@scope/single/style.css')!,
    );

    expect(result.watchFiles).toEqual([
      path.join(fixture.root, 'auklet.config.mjs'),
      path.join(fixture.root, 'source/index.css'),
    ]);
    expect(result.watchFiles).not.toContain(
      path.join(fixture.root, 'auklet.config.js'),
    );
  });
});
