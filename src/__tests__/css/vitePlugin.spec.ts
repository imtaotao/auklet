import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';
import type { ViteDevServer } from 'vite';

type WatchHandler = (file: string) => void;

const createServer = () => {
  const handlers = new Map<string, WatchHandler>();
  const send = vi.fn();
  const invalidateModule = vi.fn();
  const modules = new Map(
    [
      '\0auklet-css:@scope/app/style.css',
      '\0auklet-css:@scope/app/components/Button.css',
    ].map((id) => [id, { id }]),
  );

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
      moduleGraph: {
        getModuleById: vi.fn((id: string) => modules.get(id)),
        invalidateModule,
      },
      ws: {
        send,
      },
    } as unknown as ViteDevServer,
  };
};

describe('aukletStylePlugin Vite server integration', () => {
  let fixture: VirtualProject;
  let packageRoot: string;

  beforeEach(() => {
    fixture = createVirtualProject('auklet-vite-plugin-');
    fixture.writeJson('package.json', { name: '@scope/app' });
    packageRoot = fixture.root;
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('does not send full reload for source module changes', async () => {
    const context = createServer();
    const plugin = aukletStylePlugin({
      root: packageRoot,
      loadAukletConfig: async () => ({}),
    });
    const sourceFile = path.join(
      packageRoot,
      'src/components/Button/index.tsx',
    );
    fixture.writeFile(
      'src/components/Button/index.tsx',
      'export function Button() { return null; }',
    );
    fixture.writeFile(
      'src/components/Button/index.css',
      '.button { color: red; }',
    );

    await plugin.configureServer?.(context.server);
    await plugin.load?.call(
      {
        addWatchFile: vi.fn(),
      },
      '\0auklet-css:@scope/app/components/Button.css',
    );
    context.send.mockClear();
    context.handlers.get('change')?.(sourceFile);

    expect(context.invalidateModule).toHaveBeenCalledWith({
      id: '\0auklet-css:@scope/app/components/Button.css',
    });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: '/@id/__x00__auklet-css:@scope/app/components/Button.css',
          type: 'js-update',
        }),
      ],
    });
    expect(context.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
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

    context.handlers.get('change')?.(styleFile);

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

    context.handlers.get('change')?.(styleFile);

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

    context.handlers.get('change')?.(styleFile);
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
    context.handlers.get('change')?.(configFile);

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
