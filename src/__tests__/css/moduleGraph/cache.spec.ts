import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
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
  packagePath,
  setupMonorepoPackages,
  uiPackageRoot,
} from './helpers';
import { collectStyleImports } from '../../fixtures/styleStructure';

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

  const createPackageSource = (packages: Array<StylePackageInfo>) =>
    ({
      getPackages: () => packages,
      getPackageNames: () => packages.map((item) => item.packageName),
      getWatchRoots: async () => [],
      isKnownPackageName: (packageName: string) =>
        packages.some((item) => item.packageName === packageName),
      isSourceGraphFile: () => true,
    }) satisfies StylePackageSource;

  const createDeferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolver, rejecter) => {
      resolve = resolver;
      reject = rejecter;
    });
    return {
      promise,
      resolve,
      reject,
    };
  };

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

  test('keeps dependency tracking from the newest in-flight load result', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/dep-old',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
        {
          packageName: '@scope/dep-new',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const first = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const second = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const firstCreate = vi.fn(() =>
      first.promise.then((result) => ({ result })),
    );
    const secondCreate = vi.fn(() =>
      second.promise.then((result) => ({ result })),
    );

    const firstLoad = graph.getLoadResult(parsed, firstCreate);
    graph.invalidatePackage('@scope/app');
    const secondLoad = graph.getLoadResult(parsed, secondCreate);

    second.resolve({
      code: 'new',
      watchFiles: [],
      dependencyPackages: ['@scope/dep-new'],
    });
    await expect(secondLoad).resolves.toMatchObject({ code: 'new' });

    first.resolve({
      code: 'old',
      watchFiles: [],
      dependencyPackages: ['@scope/dep-old'],
    });
    await expect(firstLoad).resolves.toMatchObject({ code: 'new' });

    graph.invalidatePackage('@scope/dep-old');
    const followUpCreate = vi.fn(async () => ({
      result: {
        code: 'follow-up',
        watchFiles: [],
      },
    }));

    await expect(
      graph.getLoadResult(parsed, followUpCreate),
    ).resolves.toMatchObject({ code: 'new' });
    expect(followUpCreate).not.toHaveBeenCalled();
  });

  test('recreates a load result after a rejected request', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const create = vi.fn(async () => {
      if (create.mock.calls.length === 1) {
        throw new Error('failed to build css');
      }
      return {
        result: {
          code: 'recovered',
          watchFiles: [],
          dependencyPackages: ['@scope/app'],
        },
      };
    });

    await expect(graph.getLoadResult(parsed, create)).rejects.toThrow(
      'failed to build css',
    );
    await expect(graph.getLoadResult(parsed, create)).resolves.toMatchObject({
      code: 'recovered',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('retries a rejected in-flight load after dependency invalidation', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/ui',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const first = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const create = vi
      .fn()
      .mockImplementationOnce(() =>
        first.promise.then((result) => ({ result })),
      )
      .mockResolvedValueOnce({
        result: {
          code: 'fresh',
          watchFiles: [],
          dependencyPackages: ['@scope/ui'],
        },
      });

    const load = graph.getLoadResult(parsed, create);
    graph.invalidatePackage('@scope/ui');

    first.reject(new Error('stale request failed'));

    await expect(load).resolves.toMatchObject({ code: 'fresh' });
    expect(create).toHaveBeenCalledTimes(2);
    await expect(graph.getLoadResult(parsed, create)).resolves.toMatchObject({
      code: 'fresh',
    });
  });

  test('does not commit stale in-flight results after dependency invalidation', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/ui',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const commit = vi.fn();
    const first = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const create = vi
      .fn()
      .mockImplementationOnce(() =>
        first.promise.then((result) => ({ result, commit })),
      )
      .mockResolvedValueOnce({
        result: {
          code: 'fresh',
          watchFiles: [],
          dependencyPackages: ['@scope/ui'],
        },
      });

    const load = graph.getLoadResult(parsed, create);
    graph.invalidatePackage('@scope/ui');

    first.resolve({
      code: 'stale',
      watchFiles: [],
      dependencyPackages: ['@scope/ui'],
    });

    await expect(load).resolves.toMatchObject({ code: 'fresh' });
    expect(commit).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('ignores late dependency writes from stale in-flight results', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/dep-a',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
        {
          packageName: '@scope/dep-b',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const deferred = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const create = vi.fn(() => deferred.promise.then((result) => ({ result })));

    const load = graph.getLoadResult(parsed, create);
    graph.invalidatePackage('@scope/app');
    graph.invalidatePackage('@scope/dep-a');
    const followUpCreate = vi.fn(async () => ({
      result: {
        code: 'fresh',
        watchFiles: [],
        dependencyPackages: ['@scope/dep-b'],
      },
    }));
    await expect(
      graph.getLoadResult(parsed, followUpCreate),
    ).resolves.toMatchObject({ code: 'fresh' });

    deferred.resolve({
      code: 'stale',
      watchFiles: [],
      dependencyPackages: ['@scope/dep-a'],
    });
    await expect(load).resolves.toMatchObject({ code: 'fresh' });

    graph.invalidatePackage('@scope/dep-a');
    const afterStaleCreate = vi.fn(async () => ({
      result: {
        code: 'after-stale',
        watchFiles: [],
      },
    }));

    await expect(
      graph.getLoadResult(parsed, afterStaleCreate),
    ).resolves.toMatchObject({ code: 'fresh' });
    expect(afterStaleCreate).not.toHaveBeenCalled();
  });

  test('retries an in-flight load after package invalidation before it resolves', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/ui',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/ui',
      stylePath: 'style.css',
    };
    const first = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const create = vi
      .fn()
      .mockImplementationOnce(() =>
        first.promise.then((result) => ({ result })),
      )
      .mockResolvedValueOnce({
        result: {
          code: 'fresh',
          watchFiles: [],
          dependencyPackages: ['@scope/ui'],
        },
      });

    const load = graph.getLoadResult(parsed, create);
    graph.invalidatePackage('@scope/ui');

    first.resolve({
      code: 'stale',
      watchFiles: [],
      dependencyPackages: ['@scope/ui'],
    });

    await expect(load).resolves.toMatchObject({ code: 'fresh' });
    expect(create).toHaveBeenCalledTimes(2);
    await expect(graph.getLoadResult(parsed, create)).resolves.toMatchObject({
      code: 'fresh',
    });
  });

  test('retries an in-flight parent load when only a dependency package invalidates', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/ui',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'style.css',
    };
    const first = createDeferred<{
      code: string;
      watchFiles: Array<string>;
      dependencyPackages?: Array<string>;
    }>();
    const create = vi
      .fn()
      .mockImplementationOnce(() =>
        first.promise.then((result) => ({ result })),
      )
      .mockResolvedValueOnce({
        result: {
          code: 'fresh',
          watchFiles: [],
          dependencyPackages: ['@scope/ui'],
        },
      });

    const load = graph.getLoadResult(parsed, create);
    graph.invalidatePackage('@scope/ui');

    first.resolve({
      code: 'stale',
      watchFiles: [],
      dependencyPackages: ['@scope/ui'],
    });

    await expect(load).resolves.toMatchObject({ code: 'fresh' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('does not invalidate unrelated load results from the same package when a dependency package changes', async () => {
    const graph = new ModuleStyleGraphRequestCache({
      config: moduleStyleBuildConfig,
      mode: 'monorepo',
      packageSource: createPackageSource([
        {
          packageName: '@scope/app',
          packageRoot: fixture.resolve(appPackageRoot),
        },
        {
          packageName: '@scope/ui',
          packageRoot: fixture.resolve(uiPackageRoot),
        },
      ]),
      root: fixture.root,
    });
    const buttonParsed = {
      packageName: '@scope/app',
      stylePath: 'components/Button.css',
    };
    const cardParsed = {
      packageName: '@scope/app',
      stylePath: 'components/Card.css',
    };
    const buttonCreate = vi.fn(async () => ({
      result: {
        code: 'button',
        watchFiles: [],
        dependencyPackages: ['@scope/ui'],
      },
    }));
    const cardCreate = vi.fn(async () => ({
      result: {
        code: 'card',
        watchFiles: [],
      },
    }));

    await expect(
      graph.getLoadResult(buttonParsed, buttonCreate),
    ).resolves.toMatchObject({
      code: 'button',
    });
    await expect(
      graph.getLoadResult(cardParsed, cardCreate),
    ).resolves.toMatchObject({
      code: 'card',
    });

    graph.invalidatePackage('@scope/ui');

    await expect(
      graph.getLoadResult(buttonParsed, buttonCreate),
    ).resolves.toMatchObject({
      code: 'button',
    });
    await expect(
      graph.getLoadResult(cardParsed, cardCreate),
    ).resolves.toMatchObject({
      code: 'card',
    });

    expect(buttonCreate).toHaveBeenCalledTimes(2);
    expect(cardCreate).toHaveBeenCalledTimes(1);
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

  test('invalidates cached style entry planner for css-only changes', async () => {
    const loadAukletConfig = vi.fn(async () => ({}));
    const collect = vi.spyOn(ModuleStyleImportCollector.prototype, 'collect');
    const invalidateStyleContent = vi.spyOn(
      StylePackageContext.prototype,
      'invalidateStyleContentCaches',
    );
    const assertPreserved = vi.spyOn(
      StylePackageContext.prototype,
      'assertPreservedLocalStyleImports',
    );
    const entryFile = fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '.button { color: red; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/base.css'),
      '.base { color: blue; }',
    );
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
      loadAukletConfig,
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'components/Button.css',
    };

    const firstResult = await graph.createPackageStyleCode(parsed);
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '@import "./base.css";\n.button { color: green; }',
    );
    graph.invalidateFileLoadResults(entryFile);
    const secondResult = await graph.createPackageStyleCode(parsed);

    expect(firstResult.code).not.toContain('@import');
    expect(secondResult.code).toContain('@import');
    expect(secondResult.code).toContain('base.css');
    expect(secondResult.code).toContain('.button { color: green; }');
    expect(loadAukletConfig).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(invalidateStyleContent).toHaveBeenCalledTimes(1);
    expect(assertPreserved).toHaveBeenCalledTimes(2);
  });

  test('reruns preserved local CSS validation after css-only changes', async () => {
    const indexFile = fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/index.css'),
      '@import "./base.css";\n.button { color: red; }',
    );
    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/base.css'),
      '.base { color: blue; }',
    );
    const graph = new ModuleStyleGraph({
      root: fixture.root,
      mode: 'monorepo',
    });
    const parsed = {
      packageName: '@scope/app',
      stylePath: 'components/Button.css',
    };

    await expect(graph.createPackageStyleCode(parsed)).resolves.toMatchObject({
      code: expect.stringContaining('.button { color: red; }'),
    });

    fixture.writeFile(
      path.join(appPackageRoot, 'src/components/Button/base.css'),
      '@import "./index.css";\n.base { color: blue; }',
    );
    graph.invalidateFileLoadResults(indexFile);

    await expect(graph.createPackageStyleCode(parsed)).rejects.toThrow(
      'circular CSS import detected',
    );
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
    const styleFile = fixture.writeFile(
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
      '.button { color: blueviolet; }',
    );
    const stat = fs.statSync(styleFile);
    fs.utimesSync(styleFile, stat.atime, new Date(stat.mtimeMs + 1000));
    graph.invalidateFile(
      packagePath(fixture, uiPackageRoot, 'src/components/Button/index.css'),
    );
    const secondResult = await graph.createPackageStyleCode(parsed);

    expect(firstResult.code).toContain('color: red');
    expect(secondResult.code).toContain('color: blueviolet');
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
      path.join(appPackageRoot, 'src/components/App/index.css'),
      '.app { color: red; }',
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
      path.join(uiPackageRoot, 'src/components/Button/index.css'),
      '.button { color: blue; }',
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

  test('invalidates consumer persistent load results when an empty dependency package later adds styles', async () => {
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
      path.join(appPackageRoot, 'src/components/App/index.css'),
      '.app { color: red; }',
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
      path.join(uiPackageRoot, 'src/components/Button/index.css'),
      '.button { color: blue; }',
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
