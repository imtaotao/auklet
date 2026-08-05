import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { PersistentStyleGraphCache } from '#auklet/css/vite/moduleGraph/persistentCache';
import { ModuleStyleGraphRequestCache } from '#auklet/css/vite/moduleGraph/requestCache';
import type {
  StylePackageInfo,
  StylePackageSource,
} from '#auklet/css/vite/moduleGraph/packageSource/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import {
  appPackageRoot,
  setupMonorepoPackages,
  uiPackageRoot,
} from './helpers';
import { collectStyleImports } from '../../fixtures/styleStructure';

describe('ModuleStyleGraph persistent cache', () => {
  let fixture: VirtualProject;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-css-graph-');
    setupMonorepoPackages(fixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.cleanup();
  });

  const createPackageSource = (packages: Array<StylePackageInfo>) =>
    ({
      getPackages: () => packages,
      getPackageNames: () => packages.map((item) => item.packageName),
      getWatchRoots: async () => [],
      isKnownPackageName: (packageName: string) =>
        packages.some((item) => item.packageName === packageName),
      isSourceGraphFile: () => true,
    }) satisfies StylePackageSource;

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

  test('does not persist empty virtual CSS load results', async () => {
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const result = await graph.createPackageStyleCode({
      packageName: '@scope/app',
      stylePath: 'style.css',
    });

    expect(result.code).toBe('');
    expect(result.cacheInputFiles).toContain(
      fixture.resolve(path.join(appPackageRoot, 'src')),
    );
    expect(fixture.exists('node_modules/.auklet/cache/vite-style/v1')).toBe(
      false,
    );
  });

  test('keeps persistent cache keys stable for duplicate package names', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    fixture.writeJson('packages/dup-a/package.json', {
      name: '@scope/dup',
    });
    fixture.writeJson('packages/dup-b/package.json', {
      name: '@scope/dup',
    });
    const appPackage = {
      packageName: '@scope/app',
      packageRoot: fixture.resolve(appPackageRoot),
    };
    const duplicatePackageA = {
      packageName: '@scope/dup',
      packageRoot: fixture.resolve('packages/dup-a'),
    };
    const duplicatePackageB = {
      packageName: '@scope/dup',
      packageRoot: fixture.resolve('packages/dup-b'),
    };
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const firstCache = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        appPackage,
        duplicatePackageB,
        duplicatePackageA,
      ]),
      root: fixture.root,
    });
    const firstContext = await firstCache.getContext(parsed);
    expect(firstContext).not.toBeNull();
    firstCache.writePersistentLoadResult(parsed, firstContext!, {
      code: '.button { color: red; }',
      watchFiles: [],
    });
    const secondCache = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        appPackage,
        duplicatePackageA,
        duplicatePackageB,
      ]),
      root: fixture.root,
    });
    const secondContext = await secondCache.getContext(parsed);
    expect(secondContext).not.toBeNull();

    const cached = secondCache.readPersistentLoadResult(parsed, secondContext!);

    expect(cached?.code).toContain('color: red');
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

  test('invalidates persistent virtual CSS load results when Less inputs change', async () => {
    fixture.writeFile(
      path.join(appPackageRoot, 'auklet.config.js'),
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/tokens.less'),
      '@accent: red;\n',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.less'),
      '@import "./tokens.less";\n.button { color: @accent; }',
    );
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'components/Button.css',
    };
    const firstGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const firstResult = await firstGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(
      firstResult.watchFiles.some((file) => file.endsWith('tokens.less')),
    ).toBe(true);

    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/tokens.less'),
      '@accent: blue;\n',
    );
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(secondResult.code).toContain('color: blue');
    expect(secondResult.code).not.toContain('color: red');
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

  test('cleans stale persistent cache files after a write', () => {
    const cache = new PersistentStyleGraphCache({
      root: fixture.root,
    });
    const staleFile = fixture.writeFile(
      'node_modules/.auklet/cache/vite-style/v1/stale.json',
      '{}',
    );
    const staleTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, staleTime, staleTime);

    cache.write(
      cache.createKey({ test: 'cleanup-stale' }),
      {
        code: '.button { color: red; }',
        watchFiles: [],
      },
      [],
    );

    expect(fs.existsSync(staleFile)).toBe(false);
  });

  test('rechecks stale persistent cache files after the cleanup interval', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const cache = new PersistentStyleGraphCache({
        root: fixture.root,
      });
      const staleFile1 = fixture.writeFile(
        'node_modules/.auklet/cache/vite-style/v1/stale-1.json',
        '{}',
      );
      const staleTime1 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(staleFile1, staleTime1, staleTime1);

      cache.write(
        cache.createKey({ test: 'cleanup-stale-1' }),
        {
          code: '.button { color: red; }',
          watchFiles: [],
        },
        [],
      );
      expect(fs.existsSync(staleFile1)).toBe(false);

      const staleFile2 = fixture.writeFile(
        'node_modules/.auklet/cache/vite-style/v1/stale-2.json',
        '{}',
      );
      const staleTime2 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(staleFile2, staleTime2, staleTime2);

      vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
      cache.write(
        cache.createKey({ test: 'cleanup-stale-2' }),
        {
          code: '.button { color: blue; }',
          watchFiles: [],
        },
        [],
      );

      expect(fs.existsSync(staleFile2)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('limits persistent cache file count after a write', () => {
    const cacheFixtureRoot = fixture.resolve('cache-limit-fixture');
    const cacheRoot = path.join(
      cacheFixtureRoot,
      'node_modules/.auklet/cache/vite-style/v1',
    );
    const cache = new PersistentStyleGraphCache({
      root: cacheFixtureRoot,
      maxCacheFiles: 2,
    });

    fs.mkdirSync(cacheRoot, { recursive: true });
    for (let index = 0; index < 4; index += 1) {
      const file = path.join(cacheRoot, `entry-${index}.json`);
      fs.writeFileSync(file, '{}');
      const time = new Date(Date.now() - (4 - index) * 1000);
      fs.utimesSync(file, time, time);
    }

    cache.write(
      cache.createKey({ test: 'cleanup-count' }),
      {
        code: '.button { color: red; }',
        watchFiles: [],
      },
      [],
    );

    expect(
      fs
        .readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json')),
    ).toHaveLength(2);
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

    expect(collectStyleImports(firstResult.code)).toEqual([]);
    expect(firstResult.code).toContain('.page { color: black; }');
    expect(collectStyleImports(secondResult.code)).toEqual([]);
    expect(secondResult.code).toContain('.button { color: red; }');
    expect(secondResult.code).toContain('.page { color: black; }');
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

  test('skips cache writes when an input file disappears during snapshotting', () => {
    const cache = new PersistentStyleGraphCache({
      root: fixture.root,
    });
    const inputFile = fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementationOnce(() => {
      throw new Error('input disappeared');
    });

    expect(() =>
      cache.write(
        cache.createKey({ test: 'snapshot-race' }),
        {
          code: '.button { color: red; }',
          watchFiles: [],
        },
        [inputFile],
      ),
    ).not.toThrow();
    expect(statSpy).toHaveBeenCalled();
    expect(fixture.exists('node_modules/.auklet/cache/vite-style/v1')).toBe(
      false,
    );
  });

  test('tracks hoisted dependency package json as a persistent cache input', async () => {
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
      path.join('node_modules/dep/package.json'),
      {
        name: 'dep',
        exports: {
          './style.css': './style.css',
        },
      },
    );
    fixture.writeFile(
      path.join('node_modules/dep/style.css'),
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
    const cache = new PersistentStyleGraphCache({
      root: fixture.root,
    });
    const key = cache.createKey({
      packageName: '@scope/app',
      stylePath: 'style.css',
      source: 'hoisted-dependency',
    });
    cache.write(key, result, result.cacheInputFiles ?? []);
    fixture.writeJson(path.join('node_modules/dep/package.json'), {
      name: 'dep',
      exports: {
        './style.css': './blue.css',
      },
    });

    expect(result.code).toContain('dep/style.css');
    expect(result.cacheInputFiles).toContain(packageJson);
    expect(result.cacheInputFiles).not.toContain(
      fixture.resolve(
        path.join(appPackageRoot, 'node_modules/dep/package.json'),
      ),
    );
    expect(cache.read(key)).toBeNull();
  });

  test('invalidates persistent cache when workspace package root changes', async () => {
    const appRoot = 'apps/app-package';
    const firstUiRoot = 'libs-v1/ui-package';
    const secondUiRoot = 'libs-v2/ui-package';
    fixture.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - apps/*\n  - libs-v1/*\n',
    );
    fixture.writeJson(path.join(appRoot, 'package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join(firstUiRoot, 'package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join(appRoot, 'auklet.config.js'),
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
      path.join(firstUiRoot, 'src/components/Button/index.css'),
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
      'pnpm-workspace.yaml',
      'packages:\n  - apps/*\n  - libs-v2/*\n',
    );
    fixture.writeJson(path.join(secondUiRoot, 'package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join(secondUiRoot, 'src/components/Button/index.css'),
      '.button { color: blue; }',
    );
    const secondGraph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });

    const secondResult = await secondGraph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(firstResult.code).not.toContain('color: blue');
    expect(secondResult.code).toContain('color: blue');
    expect(secondResult.code).not.toContain('color: red');
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
});
