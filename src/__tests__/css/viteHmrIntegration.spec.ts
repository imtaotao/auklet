import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  toCssModuleStyleAssetBrowserUrl,
  toResolvedCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

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

const triggerViteHotUpdate = async (
  server: ViteDevServer,
  file: string,
  changeFile: () => void,
) => {
  await server.watcher.unwatch(file);
  const clientSend = vi.spyOn(server.environments.client.hot, 'send');
  const ssrSend = vi.spyOn(server.environments.ssr.hot, 'send');
  const serverSend = vi.spyOn(server.ws, 'send');

  changeFile();
  server.watcher.emit('change', file);

  await vi.waitFor(
    () => {
      expect(
        clientSend.mock.calls.length +
          ssrSend.mock.calls.length +
          serverSend.mock.calls.length,
      ).toBeGreaterThan(0);
    },
    { timeout: 2000 },
  );

  return [
    ...clientSend.mock.calls.map(([payload]) => payload),
    ...ssrSend.mock.calls.map(([payload]) => payload),
    ...serverSend.mock.calls.map(([payload]) => payload),
  ];
};

const reachesBeyondStyleBoundary = (payloads: Array<unknown>) =>
  payloads.some((payload) => {
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return false;
    }
    if (payload.type === 'full-reload') return true;
    if (payload.type !== 'update' || !('updates' in payload)) return false;
    return (payload.updates as Array<{ path: string }>).some(
      (update) =>
        !update.path.includes('.style.css') &&
        !update.path.includes('auklet-css-module-asset:'),
    );
  });

describe('auklet vite HMR integration', () => {
  let fixture: VirtualProject;
  let packageRoot: string;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createVirtualProject('auklet-vite-hmr-');
    fixture.writeJson('package.json', { name: '@scope/app' });
    fixture.writeFile(
      'auklet.config.js',
      `export const config = { source: 'src', styles: { entry: '/style.css' } };`,
    );
    packageRoot = fixture.root;
  });

  afterEach(() => {
    fixture.cleanup();
    vi.useRealTimers();
  });

  test('css module hotUpdate keeps locals non-self-accepting without faking importer acceptedHmrDeps', async () => {
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
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
      await server.ssrLoadModule('/src/useTag.ts');
      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      fixture.writeFile('src/Tag.module.css', '.label { color: blue; }');

      const modules = await runHotUpdate(plugin, server, moduleFile, 'client');
      expect(modules?.length).toBeGreaterThan(0);

      const localsId = toCssModuleVirtualId(moduleFile);
      const styleId = toCssModuleStyleVirtualId(moduleFile);
      const localsModule = modules!.find((item) => item.id === localsId);
      const styleModule = modules!.find((item) => item.id === styleId);

      expect(localsModule).toBeTruthy();
      expect(styleModule).toBeTruthy();
      expect(localsModule!.isSelfAccepting).toBe(false);
      expect(styleModule!.isSelfAccepting).toBe(true);
      expect(localsModule!.importers.size).toBeGreaterThan(0);
      for (const importer of localsModule!.importers) {
        expect(importer.acceptedHmrDeps.has(localsModule!)).toBe(false);
      }
    } finally {
      await server.close();
    }
  });

  test('virtual CSS asset browser URL returns CSS instead of Vite runtime JS', async () => {
    const assetFile = fixture.writeFile(
      'src/tokens.less',
      ':root { --tag-color: teal; }',
    );
    const moduleFile = fixture.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: packageRoot,
      plugins: [aukletStylePlugin({ root: packageRoot })],
      server: { host: '127.0.0.1', port: 0 },
    });

    try {
      await server.listen();
      const origin = server.resolvedUrls?.local[0];
      expect(origin).toBeTruthy();
      const response = await fetch(
        new URL(toCssModuleStyleAssetBrowserUrl(moduleFile, assetFile), origin),
      );
      const css = await response.text();

      expect(response.headers.get('content-type')).toContain('text/css');
      expect(css).toContain('--tag-color: teal');
      expect(css).not.toContain('__vite__updateStyle');
    } finally {
      await server.close();
    }
  });

  test('partial HMR updates virtual CSS without changing locals or reloading the importer', async () => {
    vi.useRealTimers();
    delete (globalThis as { __aukletPartialHmrEvalCount?: number })
      .__aukletPartialHmrEvalCount;
    const assetFile = fixture.writeFile(
      'src/tokens.less',
      ':root { --tag-color: red; }',
    );
    const moduleFile = fixture.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.less';
        const state = globalThis as { __aukletPartialHmrEvalCount?: number };
        state.__aukletPartialHmrEvalCount =
          (state.__aukletPartialHmrEvalCount ?? 0) + 1;
        export function getEvalCount() {
          return state.__aukletPartialHmrEvalCount;
        }
        export function getTagClass() {
          return styles.tag;
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
      server: { host: '127.0.0.1', port: 0 },
    });

    try {
      await server.listen();
      const origin = server.resolvedUrls?.local[0];
      expect(origin).toBeTruthy();
      await server.transformRequest('/src/useTag.ts');
      const firstImporter = await server.ssrLoadModule('/src/useTag.ts');
      const firstClass = firstImporter.getTagClass();
      const assetUrl = new URL(
        toCssModuleStyleAssetBrowserUrl(moduleFile, assetFile),
        origin,
      );
      const firstCss = await fetch(assetUrl).then((response) =>
        response.text(),
      );

      expect(firstCss).toContain('--tag-color: red');
      expect(firstImporter.getEvalCount()).toBe(1);
      expect(firstImporter.getLocalKeys()).toEqual(['tag']);

      const payloads = await triggerViteHotUpdate(server, assetFile, () => {
        fixture.writeFile('src/tokens.less', ':root { --tag-color: green; }');
      });
      assetUrl.searchParams.set('t', String(Date.now()));
      const nextCss = await fetch(assetUrl).then((response) => response.text());

      expect(nextCss).toContain('--tag-color: green');
      expect(nextCss).not.toContain('--tag-color: red');
      expect(firstImporter.getTagClass()).toBe(firstClass);
      expect(firstImporter.getLocalKeys()).toEqual(['tag']);
      expect(firstImporter.getEvalCount()).toBe(1);
      expect(reachesBeyondStyleBoundary(payloads)).toBe(false);
      expect(JSON.stringify(payloads)).not.toContain(
        toCssModuleVirtualId(moduleFile),
      );
      expect(JSON.stringify(payloads)).not.toContain('/src/useTag.ts');
    } finally {
      await server.close();
      delete (globalThis as { __aukletPartialHmrEvalCount?: number })
        .__aukletPartialHmrEvalCount;
    }
  });

  test('css module style-only hotUpdate returns only the style virtual module', async () => {
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
        export function getTagClass() {
          return styles.tag;
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
      await server.ssrLoadModule('/src/useTag.ts');
      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      fixture.writeFile('src/Tag.module.css', '.tag { color: blue; }');

      const modules = await runHotUpdate(plugin, server, moduleFile, 'client');
      expect(modules?.map((item) => item.id)).toEqual([
        toCssModuleStyleVirtualId(moduleFile),
      ]);
    } finally {
      await server.close();
    }
  });

  test('css module class rename hotUpdate returns locals for client and ssr environments', async () => {
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
      await server.ssrLoadModule('/src/useTag.ts');
      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      fixture.writeFile('src/Tag.module.css', '.label { color: blue; }');

      const localsId = toCssModuleVirtualId(moduleFile);
      const styleId = toCssModuleStyleVirtualId(moduleFile);
      const clientModules = await runHotUpdate(
        plugin,
        server,
        moduleFile,
        'client',
      );
      const ssrModules = await runHotUpdate(plugin, server, moduleFile, 'ssr');

      expect(clientModules?.map((item) => item.id).sort()).toEqual(
        [localsId, styleId].sort(),
      );
      expect(ssrModules?.map((item) => item.id).sort()).toEqual(
        [localsId, styleId].sort(),
      );
    } finally {
      await server.close();
    }
  });

  test('css module class rename propagation reloads importer with new locals', async () => {
    vi.useRealTimers();
    delete (globalThis as { __aukletHmrEvalCount?: number })
      .__aukletHmrEvalCount;
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
        const state = globalThis as { __aukletHmrEvalCount?: number };
        state.__aukletHmrEvalCount = (state.__aukletHmrEvalCount ?? 0) + 1;
        export function getEvalCount() {
          return state.__aukletHmrEvalCount;
        }
        export function getLocalKeys() {
          return Object.keys(styles);
        }
        export function getTagClass() {
          return styles.tag;
        }
        export function getLabelClass() {
          return styles.label;
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
      expect(first.getEvalCount()).toBe(1);
      expect(first.getLocalKeys()).toEqual(['tag']);
      expect(first.getTagClass()).toBeTruthy();

      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      const payloads = await triggerViteHotUpdate(server, moduleFile, () => {
        fixture.writeFile('src/Tag.module.css', '.label { color: blue; }');
      });
      expect(reachesBeyondStyleBoundary(payloads)).toBe(true);

      const second = await server.ssrLoadModule('/src/useTag.ts');
      expect(second.getEvalCount()).toBe(2);
      expect(second.getLocalKeys()).toEqual(['label']);
      expect(second.getLabelClass()).toBeTruthy();
      expect(second.getTagClass()).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  test('css module style-only propagation emits only the style boundary', async () => {
    vi.useRealTimers();
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
        export function getTagClass() {
          return styles.tag;
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
      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      await server.transformRequest('/src/useTag.ts');
      await server.transformRequest(toCssModuleVirtualId(moduleFile));
      await server.transformRequest(toCssModuleStyleVirtualId(moduleFile));

      const payloads = await triggerViteHotUpdate(server, moduleFile, () => {
        fixture.writeFile('src/Tag.module.css', '.tag { color: blue; }');
      });
      expect(reachesBeyondStyleBoundary(payloads)).toBe(false);
      expect(JSON.stringify(payloads)).toContain('.style.css');
      expect(JSON.stringify(payloads)).not.toContain('/src/useTag.ts');
    } finally {
      await server.close();
    }
  });

  test('css module hotUpdate returns separate nodes for client and ssr environments', async () => {
    fixture.writeFile('src/Tag.module.css', '.tag { color: red; }');
    fixture.writeFile(
      'src/useTag.ts',
      `
        import styles from './Tag.module.css';
        export function getTagClass() {
          return styles.tag;
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
      await server.ssrLoadModule('/src/useTag.ts');

      fixture.writeFile('src/Tag.module.css', '.tag { color: green; }');
      const moduleFile = path.join(packageRoot, 'src/Tag.module.css');
      const clientModules = await runHotUpdate(
        plugin,
        server,
        moduleFile,
        'client',
      );
      const ssrModules = await runHotUpdate(plugin, server, moduleFile, 'ssr');

      expect(clientModules?.length).toBeGreaterThan(0);
      expect(ssrModules?.length).toBeGreaterThan(0);
      expect(clientModules![0].id).toBe(ssrModules![0].id);
      expect(clientModules![0]).not.toBe(ssrModules![0]);
    } finally {
      await server.close();
    }
  });

  test('shared partial hotUpdate refreshes CSS Modules and package CSS', async () => {
    fixture.writeFile('src/shared/tokens.css', ':root { --chip-color: red; }');
    fixture.writeFile(
      'src/components/Chip/index.css',
      '@import "../../shared/tokens.css";\n.chip { color: var(--chip-color); }',
    );
    fixture.writeFile(
      'src/style.css',
      '@import "./components/Chip/index.css";',
    );
    fixture.writeFile(
      'src/components/Tag/Tag.module.css',
      '@import "../../shared/tokens.css";\n.tag { color: var(--chip-color); }',
    );

    fixture.writeFile(
      'src/index.ts',
      `
        import '@scope/app/style.css';
        import styles from './components/Tag/Tag.module.css';
        export const getKeys = () => Object.keys(styles);
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
      const partialFile = path.join(packageRoot, 'src/shared/tokens.css');
      const packageVirtualId = '\0auklet-css:@scope/app/style.css';

      await server.transformRequest('/src/index.ts');
      await server.ssrLoadModule('/src/index.ts');
      const moduleFile = path.join(
        packageRoot,
        'src/components/Tag/Tag.module.css',
      );
      const styleVirtualId = toCssModuleStyleVirtualId(moduleFile);
      const assetVirtualId = toResolvedCssModuleStyleAssetVirtualId(
        moduleFile,
        partialFile,
      );
      await server.transformRequest(
        toCssModuleStyleAssetBrowserUrl(moduleFile, partialFile),
      );

      fixture.writeFile(
        'src/shared/tokens.css',
        ':root { --chip-color: green; }',
      );

      const modules = await runHotUpdate(plugin, server, partialFile);
      const ids = modules?.map((item) => item.id).sort() ?? [];

      expect(ids).toContain(styleVirtualId);
      expect(ids).toContain(assetVirtualId);
      expect(ids).toContain(packageVirtualId);
    } finally {
      await server.close();
    }
  });

  test('add and unlink of package CSS invalidate graph while CSS Modules stay tracked', async () => {
    fixture.writeFile('src/tokens.less', ':root { --tag-color: red; }');
    fixture.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "../../tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const plugin = aukletStylePlugin({ root: packageRoot });
    const resolveId = plugin.resolveId;
    const resolveHandler =
      typeof resolveId === 'object' && resolveId && 'handler' in resolveId
        ? resolveId.handler
        : resolveId;
    const moduleImporter = path.join(
      packageRoot,
      'src/components/Tag/index.tsx',
    );
    const moduleFile = path.join(
      packageRoot,
      'src/components/Tag/Tag.module.less',
    );
    const styleVirtualId = toCssModuleStyleVirtualId(moduleFile);
    const resolved = await resolveHandler?.call(
      plugin,
      './Tag.module.less',
      moduleImporter,
    );
    const moduleVirtualId =
      typeof resolved === 'object' && resolved && 'id' in resolved
        ? String(resolved.id)
        : String(resolved);

    const handlers = new Map<string, (file: string) => void>();
    const send = vi.fn();
    const invalidateModule = vi.fn();
    const clientModules = new Map<string, { id: string }>();
    const clientModuleGraph = {
      getModuleById: vi.fn((id: string) => clientModules.get(id)),
      invalidateModule,
    };
    const reloadModule = vi.fn(async () => {});
    const server = {
      watcher: {
        add: vi.fn(),
        on: vi.fn((event: string, handler: (file: string) => void) => {
          handlers.set(event, handler);
        }),
      },
      environments: {
        client: { moduleGraph: clientModuleGraph, reloadModule },
        ssr: { moduleGraph: clientModuleGraph },
      },
      moduleGraph: clientModuleGraph,
      ws: { send },
      close: vi.fn(async () => {}),
    } as unknown as ViteDevServer;

    clientModules.set(moduleVirtualId, { id: moduleVirtualId });
    clientModules.set(styleVirtualId, { id: styleVirtualId });
    await plugin.configureServer?.(server);
    await plugin.load?.call({ addWatchFile: vi.fn() }, moduleVirtualId);

    const modulePartial = path.join(packageRoot, 'src/tokens.less');
    const packageCss = path.join(packageRoot, 'src/components/App/index.css');

    fixture.writeFile('src/components/App/index.css', '.app { color: red; }');
    await handlers.get('add')?.(packageCss);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' });

    send.mockClear();
    const partialModules = await runHotUpdate(plugin, server, modulePartial);
    expect(partialModules?.map((item) => item.id)).toEqual([styleVirtualId]);

    send.mockClear();
    vi.advanceTimersByTime(200);
    await handlers.get('unlink')?.(packageCss);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' });

    const afterUnlink = await runHotUpdate(plugin, server, modulePartial);
    expect(afterUnlink?.map((item) => item.id)).toEqual([styleVirtualId]);
  });
});
