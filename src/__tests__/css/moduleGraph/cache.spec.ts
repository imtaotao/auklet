import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { setupMonorepoPackages } from './helpers';

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

  test('creates a fresh package context cache for each CSS request', async () => {
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

    expect(loadAukletConfig).toHaveBeenCalledTimes(2);
  });
});
