import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { invalidateWorkspaceSharedOutputResolveCache } from '#auklet/css/modules/resolveWorkspaceSharedOutputModule';
import { toPackageStyleVirtualId } from '#auklet/css/vite/packageStyleVirtualId';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

const runHotUpdate = async (
  plugin: ReturnType<typeof aukletStylePlugin>,
  server: ViteDevServer,
  file: string,
) => {
  const hotUpdate = plugin.hotUpdate;
  const handler =
    typeof hotUpdate === 'object' && hotUpdate && 'handler' in hotUpdate
      ? hotUpdate.handler
      : hotUpdate;

  return handler?.call(
    { environment: server.environments.client } as never,
    {
      file,
      modules: [],
      server,
      timestamp: Date.now(),
      type: 'update',
      read: async () => fs.readFileSync(file, 'utf8'),
    } as never,
  );
};

const readTransformCss = (
  result: Awaited<ReturnType<ViteDevServer['transformRequest']>>,
) => {
  if (!result) return '';
  if (typeof result === 'string') return result;
  return result.code ?? '';
};

const invalidateHotModules = (
  server: ViteDevServer,
  modules: Array<{ id?: string | null }> | void,
) => {
  for (const item of modules ?? []) {
    if (!item.id) continue;
    const mod = server.environments.client.moduleGraph.getModuleById(item.id);
    if (mod) server.environments.client.moduleGraph.invalidateModule(mod);
  }
};

describe('workspace shared.output plain style Vite HMR', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-shared-output-plain-hmr-');
  });

  afterEach(() => {
    invalidateWorkspaceSharedOutputResolveCache();
    project.cleanup();
  });

  const linkWorkspaceUi = () => {
    const uiRoot = project.resolve('packages/ui');
    const appRoot = project.resolve('packages/app');
    fs.mkdirSync(path.join(appRoot, 'node_modules/@scope'), {
      recursive: true,
    });
    fs.symlinkSync(uiRoot, path.join(appRoot, 'node_modules/@scope/ui'), 'dir');
    return { uiRoot, appRoot };
  };

  test('cold-start Less (reference) hotUpdate includes consumer and recompiles from source', async () => {
    const { appRoot } = linkWorkspaceUi();
    const tokensFile = project.writeFile(
      'packages/ui/src/shared/tokens.less',
      '@token-demo-bg: tomato;\n@token-demo-fg: white;\n',
    );
    // Dist stays stale so a missed remap would bake navy into CSS.
    project.writeFile(
      'packages/ui/dist/es/shared/tokens.less',
      '@token-demo-bg: navy;\n@token-demo-fg: white;\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/tokens.less': {
          less: './dist/es/shared/tokens.less',
          default: './dist/es/shared/tokens.less',
        },
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        styles: {
          shared: { output: ['./src/shared/tokens.less'] },
        },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });
    project.writeFile(
      'packages/app/auklet.config.js',
      `export const config = { source: 'src' };`,
    );
    const demoFile = project.writeFile(
      'packages/app/src/tokens-demo.less',
      `@import (reference) '@scope/ui/shared/tokens.less';

.token-demo {
  background: @token-demo-bg;
  color: @token-demo-fg;
}
`,
    );
    project.writeFile(
      'packages/app/src/main.ts',
      `import './tokens-demo.less';\n`,
    );

    const plugin = aukletStylePlugin({ root: appRoot, mode: 'package' });
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: appRoot,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin],
    });

    try {
      // resolveId is JS-only: even with a .less importer it returns the
      // package-style virtual (Less @import remap stays in viteLessPlugin).
      const resolvedFromLess = await server.pluginContainer.resolveId(
        '@scope/ui/shared/tokens.less',
        demoFile,
      );
      expect(resolvedFromLess?.id).toBe(toPackageStyleVirtualId(tokensFile));

      // Browser-like cold start: entry + Less before any prior JS shared.output
      // import or FileManager track of the browser module id.
      await server.transformRequest('/src/main.ts');
      const first = await server.transformRequest('/src/tokens-demo.less');
      const firstCss = readTransformCss(first);
      expect(firstCss).toContain('background: tomato');
      expect(firstCss).not.toContain('navy');

      project.writeFile(
        'packages/ui/src/shared/tokens.less',
        '@token-demo-bg: lime;\n@token-demo-fg: black;\n',
      );

      const modules = await runHotUpdate(plugin, server, tokensFile);
      const ids = modules?.map((item) => item.id) ?? [];
      expect(ids).toEqual(
        expect.arrayContaining([expect.stringMatching(/tokens-demo\.less/)]),
      );
      expect(ids.some((id) => id && normalizeEndsWith(id, tokensFile))).toBe(
        false,
      );

      // hotUpdate returns ModuleNodes; Vite invalidates them before re-transform.
      invalidateHotModules(server, modules);
      const second = await server.transformRequest('/src/tokens-demo.less');
      const secondCss = readTransformCss(second);
      expect(secondCss).toContain('background: lime');
      expect(secondCss).not.toContain('tomato');
    } finally {
      await server.close();
    }
  });

  test('plain helpers.css JS import hotUpdates package-style virtual from source', async () => {
    const { appRoot } = linkWorkspaceUi();
    const helpersFile = project.writeFile(
      'packages/ui/src/shared/helpers.css',
      '.helper-reset { color: red; }\n',
    );
    project.writeFile(
      'packages/ui/dist/es/shared/helpers.css',
      '.helper-reset { color: navy; }\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/helpers.css': './dist/es/shared/helpers.css',
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        styles: {
          shared: { output: ['./src/shared/helpers.css'] },
        },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });
    project.writeFile(
      'packages/app/auklet.config.js',
      `export const config = { source: 'src' };`,
    );
    const entryFile = project.writeFile(
      'packages/app/src/main.ts',
      `import '@scope/ui/shared/helpers.css';\n`,
    );

    const plugin = aukletStylePlugin({ root: appRoot, mode: 'package' });
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: appRoot,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin],
    });
    const virtualId = toPackageStyleVirtualId(helpersFile);

    try {
      const resolved = await server.pluginContainer.resolveId(
        '@scope/ui/shared/helpers.css',
        entryFile,
      );
      expect(resolved?.id).toBe(virtualId);

      await server.transformRequest('/src/main.ts');
      const first = await server.transformRequest(virtualId);
      expect(readTransformCss(first)).toContain('color: red');
      expect(readTransformCss(first)).not.toContain('navy');

      project.writeFile(
        'packages/ui/src/shared/helpers.css',
        '.helper-reset { color: lime; }\n',
      );

      const modules = await runHotUpdate(plugin, server, helpersFile);
      expect(modules?.map((item) => item.id)).toEqual(
        expect.arrayContaining([virtualId]),
      );

      invalidateHotModules(server, modules);
      const second = await server.transformRequest(virtualId);
      expect(readTransformCss(second)).toContain('color: lime');
      expect(readTransformCss(second)).not.toContain('color: red');
    } finally {
      await server.close();
    }
  });
});

const normalizeEndsWith = (id: string, file: string) => {
  const key = path.resolve(file);
  return id === key || id.endsWith(file) || id.includes(key);
};
