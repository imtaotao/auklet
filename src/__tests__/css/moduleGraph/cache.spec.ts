import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { PersistentStyleGraphCache } from '#auklet/css/vite/moduleGraph/persistentCache';
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
    vi.restoreAllMocks();
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

  test('reuses virtual CSS load results inside one graph', async () => {
    const readStyleFile = vi.spyOn(StyleProcessor.prototype, 'readStyleFile');
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
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

    await graph.createPackageStyleCode(parsed);
    await graph.createPackageStyleCode(parsed);

    expect(readStyleFile).toHaveBeenCalledTimes(1);
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

  test('invalidates consumer persistent load results when dependency package adds styles', async () => {
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
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const firstResult = await firstGraph.createPackageStyleCode(parsed);
    fixture.writeFile(
      path.join(uiPackageRoot, 'src/components/Badge/index.css'),
      '.badge { color: blue; }',
    );
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(firstResult.code).not.toContain('color: blue');
    expect(secondResult.code).toContain('color: red');
    expect(secondResult.code).toContain('color: blue');
  });

  test('reuses persistent virtual CSS load results across graphs', async () => {
    const readStyleFile = vi.spyOn(StyleProcessor.prototype, 'readStyleFile');
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };

    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const firstResult = await firstGraph.createPackageStyleCode(parsed);
    readStyleFile.mockClear();
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(secondResult.code).toBe(firstResult.code);
    expect(readStyleFile).not.toHaveBeenCalled();
    expect(fixture.exists('node_modules/.auklet/cache/vite-style/v1')).toBe(
      true,
    );
  });

  test('invalidates persistent virtual CSS load results when inputs change', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    await firstGraph.createPackageStyleCode(parsed);
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: blue; }',
    );
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const result = await secondGraph.createPackageStyleCode(parsed);

    expect(result.code).toContain('color: blue');
    expect(result.code).not.toContain('color: red');
  });

  test('invalidates persistent virtual CSS load results when content changes without stat changes', async () => {
    const styleFile = fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    await firstGraph.createPackageStyleCode(parsed);
    const stat = fs.statSync(styleFile);
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: tan; }',
    );
    fs.utimesSync(styleFile, stat.atime, stat.mtime);
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const result = await secondGraph.createPackageStyleCode(parsed);

    expect(result.code).toContain('color: tan');
    expect(result.code).not.toContain('color: red');
  });

  test('invalidates persistent cache when a symlink target changes', () => {
    fixture.writeFile('store/dep-v1/style.css', '.dep { color: red; }');
    fixture.writeFile('store/dep-v2/style.css', '.dep { color: blue; }');
    const linkPath = fixture.resolve('node_modules/dep');
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(fixture.resolve('store/dep-v1'), linkPath, 'dir');
    const cache = new PersistentStyleGraphCache({
      root: fixture.root,
    });
    const key = cache.createKey({
      packageName: '@scope/app',
      stylePath: 'style.css',
    });

    cache.write(
      key,
      {
        code: '.dep { color: red; }',
        watchFiles: [path.join(linkPath, 'style.css')],
      },
      [path.join(linkPath, 'style.css')],
    );
    expect(cache.read(key)?.code).toContain('color: red');
    fs.unlinkSync(linkPath);
    fs.symlinkSync(fixture.resolve('store/dep-v2'), linkPath, 'dir');

    expect(cache.read(key)).toBeNull();
  });

  test('invalidates persistent virtual CSS load results when missing inputs are added', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Page/index.tsx'),
      "import { Button } from '#widgets/components/Button';",
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Page/index.css'),
      '.page { color: black; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'components/Page.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const firstResult = await firstGraph.createPackageStyleCode(parsed);
    fixture.writeJson(path.join(appPackageRoot, 'tsconfig.json'), {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '#widgets/*': ['./src/*'],
        },
      },
    });
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: black');
    expect(firstResult.code).not.toContain('color: red');
    expect(secondResult.code).toContain('color: red');
    expect(secondResult.code).toContain('color: black');
  });

  test('invalidates persistent virtual CSS load results when config changes', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    fixture.writeFile(
      path.join(uiPackageRoot, 'src/components/Card/index.css'),
      '.card { color: blue; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const firstResult = await firstGraph.createPackageStyleCode(parsed);
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
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
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(firstResult.code).not.toContain('color: blue');
    expect(secondResult.code).toContain('color: red');
    expect(secondResult.code).toContain('color: blue');
  });

  test('tracks dependency package json as a persistent cache input', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          styles: {
            dependencies: {
              dep: {
                entry: '/style.css',
              },
            },
          },
        };
      `,
    );
    const packageJson = fixture.writeJson(
      path.join(appPackageRoot, 'node_modules/dep/package.json'),
      {
        name: 'dep',
        exports: {
          './style.css': './style.css',
        },
      },
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'node_modules/dep/style.css'),
      '.dep { color: red; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const result = await graph.createPackageStyleCode(parsed);

    expect(result.code).toContain('dep/style.css');
    expect(result.cacheInputFiles).toContain(packageJson);
  });

  test('invalidates persistent cache when package json changes', () => {
    const packageJson = fixture.writeJson(
      path.join(appPackageRoot, 'node_modules/dep/package.json'),
      {
        name: 'dep',
        exports: {
          './style.css': './red.css',
        },
      },
    );
    const cache = new PersistentStyleGraphCache({
      root: fixture.root,
    });
    const key = cache.createKey({
      packageName: '@scope/app',
      stylePath: 'style.css',
    });

    cache.write(
      key,
      {
        code: '@import "dep/red.css";',
        watchFiles: [],
      },
      [packageJson],
    );
    expect(cache.read(key)?.code).toContain('red.css');
    fixture.writeJson(
      path.join(appPackageRoot, 'node_modules/dep/package.json'),
      {
        name: 'dep',
        exports: {
          './style.css': './blue.css',
        },
      },
    );

    expect(cache.read(key)).toBeNull();
  });

  test('reuses module import collection across source module requests', async () => {
    const collect = vi.spyOn(ModuleStyleImportCollector.prototype, 'collect');
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Card/index.tsx'),
      'export function Card() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Card/index.css'),
      '.card { color: blue; }',
    );
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    await graph.createPackageStyleCode({
      packageName: '@scope/app',
      stylePath: 'components/Button.css',
    });
    await graph.createPackageStyleCode({
      packageName: '@scope/app',
      stylePath: 'components/Card.css',
    });

    expect(collect).toHaveBeenCalledTimes(1);
  });
});
