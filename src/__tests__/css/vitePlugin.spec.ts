import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { AukletStyleHmr } from '#auklet/css/vite/hmr/styleHmr';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';
import {
  loadCssModuleDevPair,
  parseCssModuleDevModule,
  readPluginLoadCode,
  readPluginLoadModuleType,
} from './modules/helpers';
import {
  toCssModuleStyleAssetBrowserUrl,
  toResolvedCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import type { ViteDevServer } from 'vite';

type WatchHandler = (file: string) => void;

const createServer = (
  moduleIds: Array<string> = [
    '\0auklet-css:@scope/app/style.css',
    '\0auklet-css:@scope/app/components/Button.css',
  ],
) => {
  const handlers = new Map<string, WatchHandler>();
  const send = vi.fn();
  const invalidateModule = vi.fn();
  const reloadModule = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const modules = new Map(moduleIds.map((id) => [id, { id }]));
  const environmentModuleGraph = {
    getModuleById: vi.fn((id: string) => modules.get(id)),
    invalidateModule,
  };
  const clientEnvironment = {
    moduleGraph: environmentModuleGraph,
    reloadModule,
  };

  return {
    handlers,
    invalidateModule,
    reloadModule,
    send,
    server: {
      watcher: {
        add: vi.fn(),
        on: vi.fn((event: string, handler: WatchHandler) => {
          handlers.set(event, handler);
        }),
      },
      httpServer: null,
      environments: {
        client: clientEnvironment,
        ssr: { moduleGraph: environmentModuleGraph },
      },
      moduleGraph: environmentModuleGraph,
      reloadModule,
      ws: {
        send,
      },
      close,
    } as unknown as ViteDevServer,
    close,
  };
};

const runHotUpdate = async (
  plugin: ReturnType<typeof aukletStylePlugin>,
  server: ViteDevServer,
  file: string,
  environment: 'client' | 'ssr' = 'client',
) => {
  const hotUpdate = plugin.hotUpdate;
  const handler =
    typeof hotUpdate === 'object' && hotUpdate && 'handler' in hotUpdate
      ? hotUpdate.handler
      : hotUpdate;

  return handler?.call(
    { environment: server.environments[environment] } as never,
    {
      file,
      modules: [],
      server,
      timestamp: Date.now(),
      type: 'update',
      read: vi.fn(),
    } as never,
  );
};

const cssModuleVirtualIdsForFile = (moduleFile: string) => {
  const resolved = path.resolve(moduleFile);
  return {
    localsVirtualId: toCssModuleVirtualId(resolved),
    styleVirtualId: toCssModuleStyleVirtualId(resolved),
  };
};

describe('aukletStylePlugin Vite server integration', () => {
  let fixture: VirtualProject;
  let packageRoot: string;
  const runChange = async (handler: WatchHandler | undefined, file: string) => {
    await handler?.(file);
  };

  beforeEach(() => {
    fixture = createVirtualProject('auklet-vite-plugin-');
    fixture.writeJson('package.json', { name: '@scope/app' });
    packageRoot = fixture.root;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.cleanup();
  });

  test('does not send css updates when source module changes do not affect output', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/components/App.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const sourceFile = path.join(packageRoot, 'src/components/App/index.tsx');
    fixture.writeFile(
      'src/components/App/index.tsx',
      `
        import './style/index.css';
        import { Button } from '../Button';
        export function App() { return Button; }
      `,
    );
    fixture.writeFile(
      'src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'src/components/Button/style/index.css',
      '.button { color: blue; }',
    );

    await plugin.configureServer?.(context.server);
    await plugin.load?.call(
      {
        addWatchFile: vi.fn(),
      },
      appVirtualId,
    );
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      'src/components/App/index.tsx',
      `
        import './style/index.css';
        import { Button } from '../Button';
        export function App() { return <span />; }
      `,
    );

    await runChange(context.handlers.get('change'), sourceFile);

    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('wraps server close to cancel stale dependency pruning timers', async () => {
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const cancel = vi.spyOn(
      AukletStyleHmr.prototype,
      'cancelStaleVirtualDependencyPrune',
    );

    await plugin.configureServer?.(context.server);

    await context.server.close();

    expect(cancel).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  test('sends css updates when plugin load tracks a source module and its css output changes', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/pages/Article.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
      loadAukletConfig: async () => ({}),
    });
    const sourceFile = path.join(packageRoot, 'src/pages/Article.tsx');
    const addWatchFile = vi.fn();

    fixture.writeFile(
      'auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      'src/pages/Article.tsx',
      'export function Article() { return null; }',
    );
    fixture.writeFile(
      'src/pages/Article.css',
      '.article { color: var(--article-text); }',
    );
    fixture.writeFile(
      'src/components/ThemeToggle/index.tsx',
      'export function ThemeToggle() { return null; }',
    );
    fixture.writeFile(
      'src/components/ThemeToggle/index.css',
      '.theme-toggle { color: var(--toggle-text); }',
    );

    await plugin.configureServer?.(context.server);
    const loaded = await plugin.load?.call({ addWatchFile }, appVirtualId);
    expect(loaded).toContain('.article { color: var(--article-text); }');
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      'src/pages/Article.tsx',
      `
        import { ThemeToggle } from '../components/ThemeToggle';
        export function Article() { return ThemeToggle; }
      `,
    );

    await runChange(context.handlers.get('change'), sourceFile);

    expect(context.reloadModule).toHaveBeenCalledWith({ id: appVirtualId });
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not send css updates for unrelated css files in the same package', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/components/App.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const unrelatedFile = path.join(
      packageRoot,
      'src/components/Button/index.css',
    );
    const addWatchFile = vi.fn();

    fixture.writeFile(
      'src/components/App/index.tsx',
      'export function App() { return null; }',
    );
    fixture.writeFile('src/components/App/index.css', '.app { color: red; }');
    fixture.writeFile(
      'src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'src/components/Button/index.css',
      '.button { color: blue; }',
    );

    await plugin.configureServer?.(context.server);
    await plugin.load?.call({ addWatchFile }, appVirtualId);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    const result = await runHotUpdate(plugin, context.server, unrelatedFile);

    expect(result).toBeUndefined();
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not intercept hotUpdate for css files outside the auklet graph', async () => {
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const styleFile = path.join('/private/tmp', 'foreign.css');

    await plugin.configureServer?.(context.server);
    const result = await runHotUpdate(plugin, context.server, styleFile);

    expect(result).toBeUndefined();
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('updates source css when handwritten external css imports change', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/components/Renderer.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const externalStyleFile = path.join(
      packageRoot,
      'node_modules/@scope/ui/components/Skeleton.css',
    );
    const addWatchFile = vi.fn();

    fixture.writeFile(
      'src/components/Renderer/index.tsx',
      'export function Renderer() { return null; }',
    );
    fixture.writeFile(
      'src/components/Renderer/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.renderer { color: red; }',
    );
    fixture.writeFile(
      'node_modules/@scope/ui/components/Skeleton.css',
      '.skeleton { color: blue; }',
    );

    await plugin.configureServer?.(context.server);
    const loaded = await plugin.load?.call({ addWatchFile }, appVirtualId);
    expect(loaded).toContain('@scope/ui/components/Skeleton.css');
    expect(addWatchFile).toHaveBeenCalledWith(externalStyleFile);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      'node_modules/@scope/ui/components/Skeleton.css',
      '.skeleton { color: green; }',
    );

    const result = await runHotUpdate(
      plugin,
      context.server,
      externalStyleFile,
    );

    expect(result?.map((item) => item.id)).toEqual([appVirtualId]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('keeps source css load working when external imports are not present locally', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/components/Renderer.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const addWatchFile = vi.fn();

    fixture.writeFile(
      'src/components/Renderer/index.tsx',
      'export function Renderer() { return null; }',
    );
    fixture.writeFile(
      'src/components/Renderer/index.css',
      '@import "@scope/ui/components/Skeleton.css";\n.renderer { color: red; }',
    );

    await plugin.configureServer?.(context.server);
    const loaded = await plugin.load?.call({ addWatchFile }, appVirtualId);

    expect(loaded).toContain('@scope/ui/components/Skeleton.css');
    expect(addWatchFile).not.toHaveBeenCalledWith(
      path.join(packageRoot, 'node_modules/@scope/ui/components/Skeleton.css'),
    );
  });

  test('sends a browser error when source module css generation fails during watcher refresh', async () => {
    const appVirtualId = '\0auklet-css:@scope/app/pages/Article.css';
    const context = createServer([appVirtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const sourceFile = path.join(packageRoot, 'src/pages/Article.tsx');
    const addWatchFile = vi.fn();
    const originalCreatePackageStyleCode =
      ModuleStyleGraph.prototype.createPackageStyleCode;
    let createPackageStyleCodeCalls = 0;

    vi.spyOn(
      ModuleStyleGraph.prototype,
      'createPackageStyleCode',
    ).mockImplementation(function (this: ModuleStyleGraph, parsed) {
      createPackageStyleCodeCalls += 1;
      if (createPackageStyleCodeCalls === 2) {
        return Promise.reject(new Error('failed to build source module css'));
      }
      return originalCreatePackageStyleCode.call(this, parsed);
    });

    fixture.writeFile(
      'auklet.config.js',
      `
        export const config = {
          source: 'src',
          output: 'dist',
          modules: true,
        };
      `,
    );
    fixture.writeFile(
      'src/pages/Article.tsx',
      'export function Article() { return null; }',
    );
    fixture.writeFile(
      'src/pages/Article.css',
      '.article { color: var(--article-text); }',
    );
    fixture.writeFile(
      'src/components/ThemeToggle/index.tsx',
      'export function ThemeToggle() { return null; }',
    );
    fixture.writeFile(
      'src/components/ThemeToggle/index.css',
      '.theme-toggle { color: var(--toggle-text); }',
    );

    await plugin.configureServer?.(context.server);
    const loaded = await plugin.load?.call({ addWatchFile }, appVirtualId);
    expect(loaded).toContain('.article { color: var(--article-text); }');
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      'src/pages/Article.tsx',
      `
        import { ThemeToggle } from '../components/ThemeToggle';
        export function Article() { return ThemeToggle; }
      `,
    );

    await runChange(context.handlers.get('change'), sourceFile);

    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        err: expect.objectContaining({
          message: 'failed to build source module css',
          plugin: 'auklet-css',
        }),
      }),
    );
  });

  test('updates virtual css when a tracked css file changes through watcher', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join('packages/ui/package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join('packages/app/auklet.config.js'),
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
    fixture.writeFile(
      path.join('packages/ui/auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.tsx'),
      'export function App() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.css'),
      '.app { color: red; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: red; }',
    );

    const context = createServer();
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });
    const virtualId = '\0auklet-css:@scope/app/style.css';
    const styleFile = path.join(
      fixture.root,
      'packages/ui/src/components/Button/index.css',
    );

    await plugin.configureServer?.(context.server);
    await plugin.load?.call(
      {
        addWatchFile: vi.fn(),
      },
      virtualId,
    );
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: green; }',
    );
    const result = await runHotUpdate(plugin, context.server, styleFile);

    expect(
      context.server.environments.client.moduleGraph.getModuleById,
    ).toHaveBeenCalledWith(virtualId);
    expect(result?.map((item) => item.id)).toEqual([virtualId]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('invalidates inactive global Less consumers for provider content and exports changes', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson('packages/app/package.json', {
      name: '@scope/app',
      dependencies: { '@scope/tokens': 'workspace:*' },
    });
    fixture.writeJson('packages/tokens/package.json', {
      name: '@scope/tokens',
      exports: { './theme.less': './src/theme.less' },
    });
    fixture.writeFile(
      'packages/app/src/components/App/index.tsx',
      'export function App() { return null; }',
    );
    fixture.writeFile(
      'packages/app/src/components/App/index.less',
      '@import (reference) "@scope/tokens/theme.less";\n.app { .app-color(); }',
    );
    const providerFile = fixture.writeFile(
      'packages/tokens/src/theme.less',
      '.app-color() { color: teal; }',
    );
    const providerPackageJson = fixture.resolve('packages/tokens/package.json');
    const link = fixture.resolve('packages/app/node_modules/@scope/tokens');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fixture.resolve('packages/tokens'), link, 'dir');

    const virtualId = '\0auklet-css:@scope/app/components/App.css';
    const context = createServer([virtualId]);
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });
    const addWatchFile = vi.fn();
    await plugin.configureServer?.(context.server);
    const first = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(first).toContain('color: teal');
    expect(addWatchFile).toHaveBeenCalledWith(providerFile);
    expect(addWatchFile).toHaveBeenCalledWith(providerPackageJson);

    fixture.writeFile(
      'packages/tokens/src/theme.less',
      '.app-color() { color: purple; }',
    );
    const updates = await runHotUpdate(plugin, context.server, providerFile);
    expect(updates?.map((item) => item.id)).toContain(virtualId);

    const second = await plugin.load?.call(
      { addWatchFile: vi.fn() },
      virtualId,
    );
    expect(second).toContain('color: purple');
    expect(second).not.toContain('color: teal');

    context.server.environments.client.moduleGraph.getModuleById = vi.fn(
      () => undefined,
    );
    fixture.writeFile(
      'packages/tokens/src/theme.less',
      '.app-color() { color: orange; }',
    );
    expect(
      await runHotUpdate(plugin, context.server, providerFile),
    ).toBeUndefined();
    const inactiveRefresh = await plugin.load?.call(
      { addWatchFile },
      virtualId,
    );
    expect(inactiveRefresh).toContain('color: orange');
    expect(inactiveRefresh).not.toContain('color: purple');

    fixture.writeFile(
      'packages/tokens/src/alternate.less',
      '.app-color() { color: green; }',
    );
    fixture.writeJson('packages/tokens/package.json', {
      name: '@scope/tokens',
      exports: { './theme.less': './src/alternate.less' },
    });
    expect(
      await runHotUpdate(plugin, context.server, providerPackageJson),
    ).toBeUndefined();
    const remapped = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(remapped).toContain('color: green');
    expect(remapped).not.toContain('color: orange');
  });

  test('reloads workspace provider manifests on add and unlink', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson('packages/app/package.json', { name: '@scope/app' });
    const providerPackageJson = fixture.writeJson(
      'packages/tokens/package.json',
      { name: '@scope/tokens' },
    );
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });

    await plugin.configureServer?.(context.server);
    await runChange(context.handlers.get('unlink'), providerPackageJson);
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });

    context.send.mockClear();
    await runChange(context.handlers.get('add'), providerPackageJson);
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  test('package mode remaps inactive global Less consumers when provider exports change', async () => {
    fixture.writeJson('package.json', {
      name: '@scope/app',
      dependencies: { tokens: 'workspace:*' },
    });
    fixture.writeJson('vendor/tokens/package.json', {
      name: 'tokens',
      exports: { './theme.less': './theme.less' },
    });
    fixture.writeFile(
      'src/components/App/index.tsx',
      'export function App() { return null; }',
    );
    fixture.writeFile(
      'src/components/App/index.less',
      '@import (reference) "tokens/theme.less";\n.app { .app-color(); }',
    );
    fixture.writeFile(
      'vendor/tokens/theme.less',
      '.app-color() { color: teal; }',
    );
    const providerPackageJson = fixture.resolve('vendor/tokens/package.json');
    const link = fixture.resolve('node_modules/tokens');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fixture.resolve('vendor/tokens'), link, 'dir');

    const virtualId = '\0auklet-css:@scope/app/components/App.css';
    const context = createServer([virtualId]);
    const plugin = aukletStylePlugin({ root: packageRoot });
    const addWatchFile = vi.fn();
    await plugin.configureServer?.(context.server);
    const first = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(first).toContain('color: teal');
    expect(addWatchFile).toHaveBeenCalledWith(providerPackageJson);

    context.server.environments.client.moduleGraph.getModuleById = vi.fn(
      () => undefined,
    );
    fixture.writeFile(
      'vendor/tokens/alternate.less',
      '.app-color() { color: purple; }',
    );
    fixture.writeJson('vendor/tokens/package.json', {
      name: 'tokens',
      exports: { './theme.less': './alternate.less' },
    });
    expect(
      await runHotUpdate(plugin, context.server, providerPackageJson),
    ).toBeUndefined();
    const remapped = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(remapped).toContain('color: purple');
    expect(remapped).not.toContain('color: teal');
  });

  test('invalidates css request cache even when tracked virtual css modules are no longer live', async () => {
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeFile(
      'src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'src/components/Button/index.css',
      '.button { color: blue; }',
    );

    const virtualId = '\0auklet-css:@scope/app/style.css';
    const context = createServer([virtualId]);
    const plugin = aukletStylePlugin({
      root: packageRoot,
    });
    const addWatchFile = vi.fn();
    const styleFile = path.join(packageRoot, 'src/components/Button/index.css');

    await plugin.configureServer?.(context.server);
    const initial = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(initial).toContain('color: blue');
    context.send.mockClear();
    context.invalidateModule.mockClear();
    context.server.environments.client.moduleGraph.getModuleById = vi.fn(
      () => undefined,
    );

    fixture.writeFile(
      'src/components/Button/index.css',
      '.button { color: green; }',
    );

    const result = await runHotUpdate(plugin, context.server, styleFile);

    const refreshed = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(refreshed).toContain('color: green');
    expect(refreshed).not.toContain('color: blue');
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('keeps HMR tracking for recursive workspace package CSS dependencies', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join('packages/ui/package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join('packages/app/auklet.config.js'),
      `
        export const config = {
          source: 'src',
          styles: {
            dependencies: {
              '@scope/ui': {
                components: ['/components/**.css'],
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/ui/auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.tsx'),
      `
        import { Button } from '@scope/ui';
        export function App() { return Button; }
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.css'),
      '.app { color: red; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: blue; }',
    );
    fixture.writeFile(
      path.join('packages/app/node_modules/@scope/ui/components/Button.css'),
      '',
    );

    const appVirtualId = '\0auklet-css:@scope/app/components/App.css';
    const uiVirtualId = '\0auklet-css:@scope/ui/components/Button.css';
    const context = createServer([appVirtualId, uiVirtualId]);
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });
    const addWatchFile = vi.fn();
    const styleFile = path.join(
      fixture.root,
      'packages/ui/src/components/Button/index.css',
    );

    await plugin.configureServer?.(context.server);
    const appCode = await plugin.load?.call({ addWatchFile }, appVirtualId);
    await plugin.load?.call({ addWatchFile }, uiVirtualId);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: green; }',
    );
    const result = await runHotUpdate(plugin, context.server, styleFile);

    expect(appCode).toContain('.button { color: blue; }');
    expect(appCode).not.toContain('auklet-css:@scope/ui/components/Button.css');
    expect(addWatchFile).toHaveBeenCalledWith(styleFile);
    expect(result?.map((item) => item.id)).toEqual(
      expect.arrayContaining([appVirtualId, uiVirtualId]),
    );
    expect(context.send).not.toHaveBeenCalled();
  });

  test('lets Vite 8 transform recursive workspace package CSS dependencies', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join('packages/ui/package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join('packages/app/auklet.config.js'),
      `
        export const config = {
          source: 'src',
          styles: {
            dependencies: {
              '@scope/ui': {
                components: ['/components/**.css'],
              },
            },
          },
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/ui/auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.tsx'),
      `
        import { Button } from '@scope/ui';
        export function App() { return Button; }
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.css'),
      '.app { color: red; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: blue; }',
    );
    fixture.writeFile(
      path.join('packages/app/node_modules/@scope/ui/components/Button.css'),
      '',
    );

    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: fixture.root,
      plugins: [
        aukletStylePlugin({
          root: fixture.root,
          mode: 'monorepo',
        }),
      ],
    });

    try {
      const result = await server.transformRequest(
        '@scope/app/components/App.css',
      );

      expect(result?.code).toContain('.button { color: blue; }');
      expect(result?.code).toContain('.app { color: red; }');
      expect(result?.code).not.toContain('auklet-css:@scope/ui');
    } finally {
      await server.close();
    }
  });

  test('does not intercept untracked css file changes', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeFile(
      path.join('packages/app/auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.tsx'),
      'export function App() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.css'),
      '.app { color: red; }',
    );

    const context = createServer();
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });
    const styleFile = path.join(
      fixture.root,
      'packages/app/src/components/App/index.css',
    );

    await plugin.configureServer?.(context.server);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    await runChange(context.handlers.get('change'), styleFile);

    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not send duplicate updates for watcher and hotUpdate on the same css file', async () => {
    fixture.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    fixture.writeJson(path.join('packages/app/package.json'), {
      name: '@scope/app',
    });
    fixture.writeJson(path.join('packages/ui/package.json'), {
      name: '@scope/ui',
    });
    fixture.writeFile(
      path.join('packages/app/auklet.config.js'),
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
    fixture.writeFile(
      path.join('packages/ui/auklet.config.js'),
      `
        export const config = {
          source: 'src',
        };
      `,
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.tsx'),
      'export function App() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/app/src/components/App/index.css'),
      '.app { color: red; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.tsx'),
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: red; }',
    );

    const context = createServer();
    const plugin = aukletStylePlugin({
      root: fixture.root,
      mode: 'monorepo',
    });
    const virtualId = '\0auklet-css:@scope/app/style.css';
    const styleFile = path.join(
      fixture.root,
      'packages/ui/src/components/Button/index.css',
    );

    await plugin.configureServer?.(context.server);
    await plugin.load?.call(
      {
        addWatchFile: vi.fn(),
      },
      virtualId,
    );
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile(
      path.join('packages/ui/src/components/Button/index.css'),
      '.button { color: green; }',
    );
    const result = await runHotUpdate(plugin, context.server, styleFile);

    expect(result?.map((item) => item.id)).toEqual([virtualId]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('sends full reload for style config changes', async () => {
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: packageRoot,
      loadAukletConfig: async () => ({}),
    });
    const configFile = path.join(packageRoot, 'auklet.config.js');

    await plugin.configureServer?.(context.server);
    await runChange(context.handlers.get('change'), configFile);

    expect(context.invalidateModule).toHaveBeenCalled();
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  test('sends full reload for added style files', async () => {
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: packageRoot,
      loadAukletConfig: async () => ({}),
    });
    const styleFile = path.join(packageRoot, 'src/components/Button/index.css');

    await plugin.configureServer?.(context.server);
    context.handlers.get('add')?.(styleFile);

    expect(context.invalidateModule).toHaveBeenCalled();
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  test('reloads root package manifests on add and unlink but ignores nested manifests', async () => {
    const virtualId = '\0auklet-css:@scope/app/style.css';
    const context = createServer([virtualId]);
    const plugin = aukletStylePlugin({ root: packageRoot });
    const packageJsonFile = fixture.resolve('package.json');
    const nestedPackageJsonFile = fixture.writeJson('src/vendor/package.json', {
      name: 'nested',
    });

    await plugin.configureServer?.(context.server);

    await runChange(context.handlers.get('unlink'), packageJsonFile);
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
    context.send.mockClear();

    await runChange(context.handlers.get('add'), packageJsonFile);
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
    context.send.mockClear();
    context.invalidateModule.mockClear();

    await runChange(context.handlers.get('add'), nestedPackageJsonFile);
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });
});

describe('aukletStylePlugin CSS Modules integration', () => {
  let fixture: VirtualProject;
  let packageRoot: string;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-vite-css-modules-');
    fixture.writeJson('package.json', { name: '@scope/app' });
    packageRoot = fixture.root;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.cleanup();
  });

  test('resolveId redirects CSS Modules imports to virtual js modules', async () => {
    fixture.writeFile('src/Button.module.css', '.button {}');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const handler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;

    const resolved = await handler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const resolvedId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? resolved.id
        : resolved;

    expect(String(resolvedId)).toContain('\0auklet-css-module:');
    expect(String(resolvedId)).toContain('Button.module.css.js');
  });

  test('resolveId ignores foreign Vite virtual modules such as Module Federation shared loaders', async () => {
    const moduleFile = fixture.writeFile('src/Button.module.css', '.button {}');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const handler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;

    const foreignImporters = [
      '\0virtual:mf:__mfe_internal__host__loadShare__react__loadShare__.js',
      '\0vite/preload-helper.js',
      '\0plugin-vue:export-helper',
    ];
    const realImporter = path.join(packageRoot, 'src/Button.tsx');
    const cssModuleVirtualId = toCssModuleVirtualId(moduleFile);

    for (const foreignImporter of foreignImporters) {
      await expect(
        handler?.call(plugin, 'react', foreignImporter),
      ).resolves.toBeNull();
      await expect(
        handler?.call(plugin, './lifecycle.tsx', foreignImporter),
      ).resolves.toBeNull();
      await expect(
        handler?.call(plugin, foreignImporter, realImporter),
      ).resolves.toBeNull();

      // Owned auklet virtuals must still be reclaimed under any foreign importer.
      await expect(
        handler?.call(plugin, cssModuleVirtualId, foreignImporter),
      ).resolves.toBe(cssModuleVirtualId);
      await expect(
        handler?.call(
          plugin,
          '\0auklet-css:@scope/app/style.css',
          foreignImporter,
        ),
      ).resolves.toBe('\0auklet-css:@scope/app/style.css');
    }

    const aukletResolved = await handler?.call(
      plugin,
      './Button.module.css',
      realImporter,
    );
    const aukletResolvedId =
      typeof aukletResolved === 'object' &&
      aukletResolved &&
      'id' in aukletResolved
        ? aukletResolved.id
        : aukletResolved;
    expect(String(aukletResolvedId)).toContain('\0auklet-css-module:');
  });

  test('load registers Less partial paths from compileCssModule watchFiles', async () => {
    fixture.writeFile('src/tokens.less', '@brand: tomato;');
    const moduleFile = path.join(
      packageRoot,
      'src/components/Card/Card.module.less',
    );
    fixture.writeFile(
      'src/components/Card/Card.module.less',
      '@import "../../tokens.less";\n.card { color: @brand; }',
    );

    const addWatchFile = vi.fn();
    const plugin = aukletStylePlugin({ root: packageRoot });
    const { styleCode } = await loadCssModuleDevPair(
      plugin,
      { addWatchFile },
      moduleFile,
    );

    expect(readPluginLoadCode(styleCode)).toContain('color: tomato');
    expect(addWatchFile).toHaveBeenCalledWith(moduleFile);
    expect(addWatchFile).toHaveBeenCalledWith(
      path.join(packageRoot, 'src/tokens.less'),
    );
  });

  test('hot updates workspace external Less and watches its exports manifest', async () => {
    fixture.writeJson('package.json', {
      name: '@scope/app',
      dependencies: { tokens: 'workspace:*' },
    });
    fixture.writeJson('packages/tokens/package.json', {
      name: 'tokens',
      exports: { '.': './tokens.less' },
    });
    const tokensFile = fixture.writeFile(
      'packages/tokens/tokens.less',
      '.tag-color() { color: teal; }',
    );
    const packageJsonFile = fixture.resolve('packages/tokens/package.json');
    const link = fixture.resolve('node_modules/tokens');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fixture.resolve('packages/tokens'), link, 'dir');
    const moduleFile = fixture.writeFile(
      'src/Tag.module.less',
      '@import (reference) "tokens";\n.tag { .tag-color(); }',
    );

    const plugin = aukletStylePlugin({ root: packageRoot });
    const addWatchFile = vi.fn();
    const { localsVirtualId, styleVirtualId } =
      cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([localsVirtualId, styleVirtualId]);
    const first = await plugin.load?.call({ addWatchFile }, styleVirtualId);

    expect(readPluginLoadCode(first)).toContain('color: teal');
    expect(addWatchFile).toHaveBeenCalledWith(tokensFile);
    expect(addWatchFile).toHaveBeenCalledWith(packageJsonFile);

    fixture.writeFile(
      'packages/tokens/tokens.less',
      '.tag-color() { color: purple; }',
    );
    const updated = await runHotUpdate(plugin, context.server, tokensFile);
    expect(updated?.map((item) => item.id)).toEqual([styleVirtualId]);
    const second = await plugin.load?.call({ addWatchFile }, styleVirtualId);
    expect(readPluginLoadCode(second)).toContain('color: purple');

    fixture.writeFile(
      'packages/tokens/alternate.less',
      '.tag-color() { color: orange; }',
    );
    fixture.writeJson('packages/tokens/package.json', {
      name: 'tokens',
      exports: { '.': './alternate.less' },
    });
    const remapped = await runHotUpdate(
      plugin,
      context.server,
      packageJsonFile,
    );
    expect(remapped?.map((item) => item.id)).toEqual([styleVirtualId]);
    const third = await plugin.load?.call({ addWatchFile }, styleVirtualId);
    expect(readPluginLoadCode(third)).toContain('color: orange');
    expect(readPluginLoadCode(third)).not.toContain('color: purple');
  });

  test('hotUpdate returns module nodes for tracked CSS Modules files', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    fixture.writeFile('src/Button.module.css', '.button {}');

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const { styleVirtualId } = cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([virtualId, styleVirtualId]);

    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();

    const result = await runHotUpdate(plugin, context.server, moduleFile);

    expect(result?.map((item) => item.id)).toEqual([styleVirtualId]);
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('hotUpdate on CSS Modules file returns module nodes without full-reload', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    fixture.writeFile('src/Button.module.css', '.button { color: red; }');

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const { styleVirtualId } = cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([virtualId, styleVirtualId]);

    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    fixture.writeFile('src/Button.module.css', '.button { color: blue; }');
    const result = await runHotUpdate(plugin, context.server, moduleFile);

    expect(result?.map((item) => item.id)).toEqual([styleVirtualId]);
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('hotUpdate on CSS Modules Less partial returns module nodes', async () => {
    const importer = path.join(packageRoot, 'src/components/Tag/index.tsx');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;

    fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    fixture.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const resolved = await resolveHandler?.call(
      plugin,
      './Tag.module.less',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const moduleFile = path.join(
      packageRoot,
      'src/components/Tag/Tag.module.less',
    );
    const { styleVirtualId } = cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([virtualId, styleVirtualId]);

    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();

    const partialFile = path.join(
      packageRoot,
      'src/components/Tag/tokens.less',
    );
    fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #111827; }',
    );
    const result = await runHotUpdate(plugin, context.server, partialFile);

    expect(result?.map((item) => item.id)).toEqual([styleVirtualId]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('reloads CSS Modules css and locals when load runs after source edits', async () => {
    const moduleFile = path.join(
      packageRoot,
      'src/components/Button/Button.module.css',
    );
    fixture.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: red; }',
    );

    const plugin = aukletStylePlugin({ root: packageRoot });
    const loadContext = { addWatchFile: vi.fn() };
    const firstDev = await loadCssModuleDevPair(
      plugin,
      loadContext,
      moduleFile,
    );
    const first = parseCssModuleDevModule(
      firstDev.localsCode!,
      firstDev.styleCode!,
    );

    expect(first.css).toContain('color: red');
    expect(first.locals.button).toBeTruthy();

    fixture.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: blue; }\n.icon { width: 1rem; }',
    );

    const secondDev = await loadCssModuleDevPair(
      plugin,
      loadContext,
      moduleFile,
    );
    const second = parseCssModuleDevModule(
      secondDev.localsCode!,
      secondDev.styleCode!,
    );

    expect(second.css).toContain('color: blue');
    expect(second.css).not.toBe(first.css);
    expect(second.locals.button).toBe(first.locals.button);
    expect(second.locals.icon).toBeTruthy();
    expect(second.locals).not.toEqual(first.locals);
  });

  test('reloads a virtual CSS asset when a Less partial changes', async () => {
    const tokensFile = fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    const moduleFile = path.join(
      packageRoot,
      'src/components/Tag/Tag.module.less',
    );
    fixture.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const plugin = aukletStylePlugin({ root: packageRoot });
    const loadContext = { addWatchFile: vi.fn() };
    const firstDev = await loadCssModuleDevPair(
      plugin,
      loadContext,
      moduleFile,
    );
    const first = parseCssModuleDevModule(
      firstDev.localsCode!,
      firstDev.styleCode!,
    );

    expect(first.css).toContain('@import');
    expect(first.css).not.toContain('--tag-color: #0f766e');
    const assetVirtualId = toResolvedCssModuleStyleAssetVirtualId(
      moduleFile,
      tokensFile,
    );
    const assetBrowserUrl = toCssModuleStyleAssetBrowserUrl(
      moduleFile,
      tokensFile,
    );
    expect(decodeURIComponent(assetBrowserUrl)).toContain(moduleFile);
    expect(decodeURIComponent(assetBrowserUrl)).toContain(tokensFile);
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    expect(await resolveHandler?.call(plugin, assetBrowserUrl)).toBe(
      assetVirtualId,
    );
    const firstAsset = await plugin.load?.call(loadContext, assetVirtualId);
    expect(readPluginLoadCode(firstAsset)).toContain('--tag-color: #0f766e');

    fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #111827; }',
    );

    const secondDev = await loadCssModuleDevPair(
      plugin,
      loadContext,
      moduleFile,
    );
    const second = parseCssModuleDevModule(
      secondDev.localsCode!,
      secondDev.styleCode!,
    );

    const secondAsset = await plugin.load?.call(loadContext, assetVirtualId);
    expect(readPluginLoadCode(secondAsset)).toContain('--tag-color: #111827');
    expect(readPluginLoadCode(secondAsset)).not.toContain('#0f766e');
    expect(second.css).toBe(first.css);
    expect(second.locals).toEqual(first.locals);
  });

  test('load returns JS locals and raw virtual CSS styles', async () => {
    fixture.writeFile('src/Button.module.css', '.button {}');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      path.join(packageRoot, 'src/Button.tsx'),
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);

    const loaded = await plugin.load?.call(
      { addWatchFile: vi.fn() },
      virtualId,
    );
    const styleLoaded = await plugin.load?.call(
      { addWatchFile: vi.fn() },
      toCssModuleStyleVirtualId(
        path.join(packageRoot, 'src/Button.module.css'),
      ),
    );

    expect(readPluginLoadModuleType(loaded)).toBe('js');
    expect(readPluginLoadCode(loaded)).not.toContain(
      'import.meta.hot.accept()',
    );
    expect(readPluginLoadModuleType(styleLoaded)).toBe(null);
    expect(readPluginLoadCode(styleLoaded)).toContain('.Button_button_');
    expect(readPluginLoadCode(styleLoaded)).not.toContain('document.');
    expect(String(virtualId)).toMatch(/\.module\.css\.js$/);
    expect(String(virtualId)).not.toMatch(/\.style\.js$/);
  });

  test('css module hotUpdate returns environment module nodes with importers', async () => {
    fixture.writeFile(
      'auklet.config.js',
      `export const config = { source: 'src' };`,
    );
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
        export function getTagClass() {
          return styles.tag;
        }
        export function getLabelClass() {
          return styles.label;
        }
        export function getLocalKeys() {
          return Object.keys(styles);
        }
      `,
    );

    const plugin = aukletStylePlugin({ root: packageRoot });
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: packageRoot,
      plugins: [plugin],
    });

    try {
      await server.transformRequest('/src/useTag.ts');
      const first = await server.ssrLoadModule('/src/useTag.ts');
      expect(first.getLocalKeys()).toContain('tag');

      fixture.writeFile('src/Tag.module.css', '.label { color: blue; }');

      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      const modules = await runHotUpdate(plugin, server, moduleFile);

      expect(modules?.length).toBeGreaterThan(0);
      expect(modules![0].importers.size).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  test('hotUpdate returns undefined for untracked CSS Modules files', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    fixture.writeFile('src/Button.module.css', '.button {}');
    const plugin = aukletStylePlugin({ root: packageRoot });

    const result = await runHotUpdate(
      plugin,
      createServer().server,
      moduleFile,
    );

    expect(result).toBeUndefined();
  });

  test('hotUpdate returns module nodes on repeated css module updates', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    fixture.writeFile('src/Button.module.css', '.button { color: red; }');

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const { styleVirtualId } = cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([virtualId, styleVirtualId]);

    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();

    const first = await runHotUpdate(plugin, context.server, moduleFile);
    const second = await runHotUpdate(plugin, context.server, moduleFile);

    expect(first?.map((item) => item.id)).toEqual([styleVirtualId]);
    expect(second?.map((item) => item.id)).toEqual([styleVirtualId]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('hotUpdate uses combined style hot update for CSS Modules files', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    fixture.writeFile('src/Button.module.css', '.button {}');

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const { styleVirtualId } = cssModuleVirtualIdsForFile(moduleFile);
    const context = createServer([virtualId, styleVirtualId]);

    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);

    const result = await runHotUpdate(plugin, context.server, moduleFile);

    expect(result?.map((item) => item.id)).toEqual([styleVirtualId]);
  });

  test('unlink of tracked CSS Modules partial sends full reload', async () => {
    const importer = path.join(packageRoot, 'src/components/Tag/index.tsx');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;

    fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    fixture.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const resolved = await resolveHandler?.call(
      plugin,
      './Tag.module.less',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const partialFile = path.join(
      packageRoot,
      'src/components/Tag/tokens.less',
    );
    const context = createServer([virtualId]);

    await plugin.configureServer?.(context.server);
    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    await context.handlers.get('unlink')?.(partialFile);

    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
    expect(context.invalidateModule).toHaveBeenCalled();
  });

  test('unlink of an SSR-only CSS Modules partial clears tracking', async () => {
    const importer = path.join(packageRoot, 'src/components/Tag/index.tsx');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;

    fixture.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: #0f766e; }',
    );
    fixture.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const resolved = await resolveHandler?.call(
      plugin,
      './Tag.module.less',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const partialFile = path.join(
      packageRoot,
      'src/components/Tag/tokens.less',
    );
    const context = createServer([]);
    const ssrInvalidateModule = vi.fn();
    context.server.environments.ssr.moduleGraph = {
      getModuleById: vi.fn((id: string) =>
        id === virtualId ? ({ id } as never) : undefined,
      ),
      invalidateModule: ssrInvalidateModule,
    } as never;

    await plugin.configureServer?.(context.server);
    await plugin.load?.call(
      {
        addWatchFile: vi.fn(),
        environment: { name: 'ssr' },
      },
      virtualId,
    );
    context.send.mockClear();

    await context.handlers.get('unlink')?.(partialFile);

    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
    expect(ssrInvalidateModule).toHaveBeenCalledWith(
      expect.objectContaining({ id: virtualId }),
    );
  });

  test('unlink of CSS Modules entry sends full reload', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const importer = path.join(packageRoot, 'src/Button.tsx');
    fixture.writeFile('src/Button.module.css', '.button {}');

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const resolved = await resolveHandler?.call(
      plugin,
      './Button.module.css',
      importer,
    );
    const virtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);
    const context = createServer([virtualId]);

    await plugin.configureServer?.(context.server);
    await plugin.load?.call({ addWatchFile: vi.fn() }, virtualId);
    context.send.mockClear();
    context.invalidateModule.mockClear();

    await context.handlers.get('unlink')?.(moduleFile);

    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
    expect(context.invalidateModule).toHaveBeenCalled();
  });

  test('add of CSS Modules entry sends full reload', async () => {
    const moduleFile = path.join(packageRoot, 'src/Button.module.css');
    const plugin = aukletStylePlugin({ root: packageRoot });
    const context = createServer();

    await plugin.configureServer?.(context.server);
    context.send.mockClear();

    await context.handlers.get('add')?.(moduleFile);

    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });
});
