import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  appPackageRoot,
  packagePath,
  setupMonorepoPackages,
  uiPackageRoot,
} from './helpers';

describe('ModuleStyleGraph request cache', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-');
    setupMonorepoPackages(fixture);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('reuses package contexts inside one CSS request', async () => {
    const loadAukletConfig = vi.fn(
      async (packageRoot: string, _options?: { cacheBust?: boolean }) => {
        if (path.basename(packageRoot) === 'app-package') {
          return {
            styles: {
              dependencies: {
                '@scope/ui': {
                  entry: ['/style.css', '/style.css'],
                },
              },
            },
          };
        }

        return {};
      },
    );
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
      loadAukletConfig,
    });

    await graph.createPackageStyleCode({
      packageName: '@scope/app',
      stylePath: 'style.css',
    });

    expect(loadAukletConfig).toHaveBeenCalledTimes(2);
    expect(
      loadAukletConfig.mock.calls.map(([packageRoot]) =>
        path.basename(packageRoot),
      ),
    ).toEqual(['app-package', 'ui-package']);
    expect(
      loadAukletConfig.mock.calls.every(
        ([, options]) => options?.cacheBust === true,
      ),
    ).toBe(true);
  });

  test('reuses package contexts across CSS requests', async () => {
    const loadAukletConfig = vi.fn(async () => ({}));
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
      loadAukletConfig,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };

    await graph.createPackageStyleCode(parsed);
    await graph.createPackageStyleCode(parsed);

    expect(loadAukletConfig).toHaveBeenCalledTimes(1);
  });

  test('invalidates package context for changed package files', async () => {
    const loadAukletConfig = vi.fn(async () => ({}));
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
      loadAukletConfig,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };

    await graph.createPackageStyleCode(parsed);
    expect(
      graph.invalidateFile(
        packagePath(fixture, appPackageRoot, 'src/components/Button/index.css'),
      ),
    ).toBe('@scope/app');
    await graph.createPackageStyleCode(parsed);

    expect(loadAukletConfig).toHaveBeenCalledTimes(2);
  });

  test('invalidates package context for config changes', async () => {
    const loadAukletConfig = vi.fn(async () => ({}));
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
      loadAukletConfig,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };

    await graph.createPackageStyleCode(parsed);
    expect(
      graph.invalidateFile(
        packagePath(fixture, appPackageRoot, 'auklet.config.js'),
      ),
    ).toBe('@scope/app');
    await graph.createPackageStyleCode(parsed);

    expect(loadAukletConfig).toHaveBeenCalledTimes(2);
  });

  test('uses fresh dependency package context from cached recursive requests', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          styles: {
            dependencies: {
              '@scope/ui': {
                entry: '/style.css',
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      path.join(uiPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };

    const firstResult = await graph.createPackageStyleCode(parsed);
    fixture.writeFile(
      path.join(uiPackageRoot, 'src/components/Button/index.css'),
      '.button { color: blue; }',
    );
    graph.invalidateFile(
      packagePath(fixture, uiPackageRoot, 'src/components/Button/index.css'),
    );
    const secondResult = await graph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(secondResult.code).toContain('color: blue');
    expect(secondResult.code).not.toContain('color: red');
  });
});
