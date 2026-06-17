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
