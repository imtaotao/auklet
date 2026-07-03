import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { AukletStyleHmr } from '#auklet/css/vite/hmr';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';
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
  const close = vi.fn(async () => {});
  const modules = new Map(moduleIds.map((id) => [id, { id }]));

  return {
    handlers,
    invalidateModule,
    send,
    server: {
      watcher: {
        add: vi.fn(),
        on: vi.fn((event: string, handler: WatchHandler) => {
          handlers.set(event, handler);
        }),
      },
      httpServer: null,
      moduleGraph: {
        getModuleById: vi.fn((id: string) => modules.get(id)),
        invalidateModule,
      },
      ws: {
        send,
      },
      close,
    } as unknown as ViteDevServer,
    close,
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

    expect(context.invalidateModule).toHaveBeenCalledWith({
      id: appVirtualId,
    });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/app/pages/Article.css',
          type: 'js-update',
        }),
      ],
    });
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

    await runChange(context.handlers.get('change'), styleFile);

    expect(context.server.moduleGraph.getModuleById).toHaveBeenCalledWith(
      virtualId,
    );
    expect(context.invalidateModule).toHaveBeenCalledWith({
      id: virtualId,
    });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/app/style.css',
          type: 'js-update',
        }),
      ],
    });
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
    context.server.moduleGraph.getModuleById = vi.fn(() => undefined);

    fixture.writeFile(
      'src/components/Button/index.css',
      '.button { color: green; }',
    );

    await runChange(context.handlers.get('change'), styleFile);

    const refreshed = await plugin.load?.call({ addWatchFile }, virtualId);
    expect(refreshed).toContain('color: green');
    expect(refreshed).not.toContain('color: blue');
    expect(context.invalidateModule).not.toHaveBeenCalled();
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

    await runChange(context.handlers.get('change'), styleFile);

    expect(appCode).toContain('.button { color: blue; }');
    expect(appCode).not.toContain('auklet-css:@scope/ui/components/Button.css');
    expect(addWatchFile).toHaveBeenCalledWith(styleFile);
    expect(context.invalidateModule).toHaveBeenCalledWith({ id: appVirtualId });
    expect(context.invalidateModule).toHaveBeenCalledWith({ id: uiVirtualId });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: expect.arrayContaining([
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/app/components/App.css',
          type: 'js-update',
        }),
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/ui/components/Button.css',
          type: 'js-update',
        }),
      ]),
    });
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

    await runChange(context.handlers.get('change'), styleFile);
    await plugin.hotUpdate?.handler?.({
      file: styleFile,
      modules: [],
      server: context.server,
      timestamp: Date.now(),
      type: 'update',
      read: vi.fn(),
    } as never);

    expect(context.invalidateModule).toHaveBeenCalledTimes(1);
    expect(context.send).toHaveBeenCalledTimes(1);
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/app/style.css',
          type: 'js-update',
        }),
      ],
    });
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
});
