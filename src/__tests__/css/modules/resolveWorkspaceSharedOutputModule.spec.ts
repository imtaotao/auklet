import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import { loadAukletConfig } from '#auklet/configLoader';
import { resolveExternalLessImport } from '#auklet/css/core/resolvers/externalLess';
import {
  remapSharedOutputDistAssetToSource,
  remapWorkspaceSharedOutputLessFile,
} from '#auklet/css/core/style/sharedOutput';
import { compileCssModule } from '#auklet/css/modules/compileCssModule';
import { createGenerateScopedName } from '#auklet/css/modules/generateScopedName';
import {
  invalidateWorkspaceSharedOutputResolveCache,
  loadProducerSharedOutputCache,
  resolveWorkspaceSharedOutputModule,
  resolveWorkspaceSharedOutputPlainStyle,
  warmWorkspaceSharedOutputCaches,
} from '#auklet/css/modules/resolveWorkspaceSharedOutputModule';
import {
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import { normalizeFileKey } from '#auklet/utils';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('resolveWorkspaceSharedOutputModule', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-workspace-shared-hmr-');
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

  test('maps workspace exports→shim to producer shared.output source', async () => {
    const { uiRoot, appRoot } = linkWorkspaceUi();
    const moduleFile = project.writeFile(
      'packages/ui/src/shared/chip.module.less',
      '.chip { color: red; }\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        modules: true,
        styles: { shared: { output: './src/shared/**/*.module.{less,css}' } },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });

    // Dist shim is intentionally missing — workspace HMR must not require it.
    expect(
      await resolveWorkspaceSharedOutputModule({
        source: '@scope/ui/shared/chip.module.less',
        importerPackageRoot: appRoot,
      }),
    ).toBe(moduleFile);

    // Installed copy under node_modules (no symlink out) stays on the shim path.
    const installedRoot = project.resolve('packages/installed-app');
    project.writeJson('packages/installed-app/package.json', {
      name: '@scope/installed-app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    project.writeJson(
      'packages/installed-app/node_modules/@scope/ui/package.json',
      {
        name: '@scope/ui',
        exports: {
          './shared/chip.module.less': {
            import: './dist/es/shared/chip.module.less.js',
            default: './dist/es/shared/chip.module.less.js',
          },
        },
      },
    );
    project.writeFile(
      'packages/installed-app/node_modules/@scope/ui/src/shared/chip.module.less',
      '.chip { color: red; }\n',
    );
    project.writeFile(
      'packages/installed-app/node_modules/@scope/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        modules: true,
        styles: { shared: { output: './src/shared/**/*.module.{less,css}' } },
      };`,
    );
    expect(
      await resolveWorkspaceSharedOutputModule({
        source: '@scope/ui/shared/chip.module.less',
        importerPackageRoot: installedRoot,
      }),
    ).toBeNull();
    expect(uiRoot).toBeTruthy();
  });

  test('maps workspace exports→dist plain css/less to producer source', async () => {
    const { appRoot } = linkWorkspaceUi();
    const helpers = project.writeFile(
      'packages/ui/src/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    const tokens = project.writeFile(
      'packages/ui/src/shared/tokens.less',
      '@brand: #111;\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/helpers.css': './dist/es/shared/helpers.css',
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
          shared: {
            output: ['./src/shared/helpers.css', './src/shared/tokens.less'],
          },
        },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });

    expect(
      await resolveWorkspaceSharedOutputPlainStyle({
        source: '@scope/ui/shared/helpers.css',
        importerPackageRoot: appRoot,
      }),
    ).toBe(helpers);
    expect(
      await resolveWorkspaceSharedOutputPlainStyle({
        source: '@scope/ui/shared/tokens.less',
        importerPackageRoot: appRoot,
      }),
    ).toBe(tokens);
  });

  test('plain workspace resolve / Less remap follow config output (not hardcoded dist/)', async () => {
    const { uiRoot, appRoot } = linkWorkspaceUi();
    const helpers = project.writeFile(
      'packages/ui/src/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    const tokens = project.writeFile(
      'packages/ui/src/shared/tokens.less',
      '@brand: #111;\n',
    );
    const publishedHelpers = project.writeFile(
      'packages/ui/build/es/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    const publishedTokens = project.writeFile(
      'packages/ui/build/es/shared/tokens.less',
      '@brand: #111;\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/helpers.css': './build/es/shared/helpers.css',
        './shared/tokens.less': {
          less: './build/es/shared/tokens.less',
          default: './build/es/shared/tokens.less',
        },
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        output: 'build',
        styles: {
          shared: {
            output: ['./src/shared/helpers.css', './src/shared/tokens.less'],
          },
        },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });

    expect(
      await resolveWorkspaceSharedOutputPlainStyle({
        source: '@scope/ui/shared/helpers.css',
        importerPackageRoot: appRoot,
      }),
    ).toBe(helpers);

    await loadProducerSharedOutputCache(uiRoot);
    expect(
      remapSharedOutputDistAssetToSource({
        packageRoot: uiRoot,
        sourceRoot: path.join(uiRoot, 'src'),
        outputDir: 'build',
        outputFormats: ['es', 'lib'],
        resolvedFile: publishedHelpers,
        plainFileKeys: [helpers, tokens].map(normalizeFileKey),
      }),
    ).toBe(helpers);
    expect(
      remapWorkspaceSharedOutputLessFile({
        packageRoot: uiRoot,
        resolvedFile: publishedTokens,
        sourceRelative: 'shared/tokens.less',
      }),
    ).toBe(tokens);
    expect(
      resolveExternalLessImport('@scope/ui/shared/tokens.less', appRoot).file,
    ).toBe(tokens);
  });

  test('Less (reference) remaps after Vite warm without prior JS shared.output import', async () => {
    const { uiRoot, appRoot } = linkWorkspaceUi();
    const tokens = project.writeFile(
      'packages/ui/src/shared/tokens.less',
      '@brand: #111;\n',
    );
    const publishedTokens = project.writeFile(
      'packages/ui/dist/es/shared/tokens.less',
      '@brand: stale;\n',
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
        styles: { shared: { output: './src/shared/tokens.less' } },
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

    // Cold: sync Less remap must not guess src/ without a warm cache.
    invalidateWorkspaceSharedOutputResolveCache();
    expect(
      resolveExternalLessImport('@scope/ui/shared/tokens.less', appRoot).file,
    ).toBe(fs.realpathSync.native(publishedTokens));

    // Vite configureServer warms graph packages + workspace deps — no JS import.
    const plugin = aukletStylePlugin({ root: appRoot, mode: 'package' });
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: appRoot,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin],
    });
    try {
      expect(
        resolveExternalLessImport('@scope/ui/shared/tokens.less', appRoot).file,
      ).toBe(tokens);
    } finally {
      await server.close();
    }

    // Explicit warm API (same as graph.warmSharedOutputRemapCaches) for output:build.
    invalidateWorkspaceSharedOutputResolveCache();
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        output: 'build',
        styles: { shared: { output: './src/shared/tokens.less' } },
      };`,
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/tokens.less': {
          less: './build/es/shared/tokens.less',
          default: './build/es/shared/tokens.less',
        },
      },
    });
    const publishedBuildTokens = project.writeFile(
      'packages/ui/build/es/shared/tokens.less',
      '@brand: stale-build;\n',
    );
    await warmWorkspaceSharedOutputCaches({ packageRoots: [uiRoot, appRoot] });
    expect(
      resolveExternalLessImport('@scope/ui/shared/tokens.less', appRoot).file,
    ).toBe(tokens);
    expect(publishedBuildTokens).toBeTruthy();
  });

  test('installed package Less (reference) stays on published dist', async () => {
    const installedRoot = project.resolve('packages/installed-app');
    const publishedTokens = project.writeFile(
      'packages/installed-app/node_modules/@scope/ui/dist/es/shared/tokens.less',
      '@brand: published;\n',
    );
    project.writeFile(
      'packages/installed-app/node_modules/@scope/ui/src/shared/tokens.less',
      '@brand: source;\n',
    );
    project.writeJson(
      'packages/installed-app/node_modules/@scope/ui/package.json',
      {
        name: '@scope/ui',
        exports: {
          './shared/tokens.less': {
            less: './dist/es/shared/tokens.less',
            default: './dist/es/shared/tokens.less',
          },
        },
      },
    );
    project.writeFile(
      'packages/installed-app/node_modules/@scope/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        styles: { shared: { output: './src/shared/tokens.less' } },
      };`,
    );
    project.writeJson('packages/installed-app/package.json', {
      name: '@scope/installed-app',
      dependencies: { '@scope/ui': '0.0.1' },
    });

    await warmWorkspaceSharedOutputCaches({
      packageRoots: [
        path.join(installedRoot, 'node_modules/@scope/ui'),
        installedRoot,
      ],
    });
    expect(
      resolveExternalLessImport('@scope/ui/shared/tokens.less', installedRoot)
        .file,
    ).toBe(fs.realpathSync.native(publishedTokens));
  });

  test('caches producer config+glob until invalidate', async () => {
    const { uiRoot, appRoot } = linkWorkspaceUi();
    const moduleFile = project.writeFile(
      'packages/ui/src/shared/chip.module.less',
      '.chip { color: red; }\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        modules: true,
        styles: { shared: { output: './src/shared/**/*.module.{less,css}' } },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });

    const loadConfig = vi.fn(loadAukletConfig);
    const resolve = () =>
      resolveWorkspaceSharedOutputModule({
        source: '@scope/ui/shared/chip.module.less',
        importerPackageRoot: appRoot,
        loadAukletConfig: loadConfig,
      });

    expect(await resolve()).toBe(moduleFile);
    expect(await resolve()).toBe(moduleFile);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledWith(uiRoot, { cacheBust: true });

    invalidateWorkspaceSharedOutputResolveCache(uiRoot);
    expect(await resolve()).toBe(moduleFile);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  test('workspace Vite HMR recompiles producer shared.output with prod hash parity', async () => {
    const { uiRoot, appRoot } = linkWorkspaceUi();
    const moduleFile = project.writeFile(
      'packages/ui/src/shared/chip.module.less',
      '.chip { color: red; }\n',
    );
    project.writeJson('packages/ui/package.json', {
      name: '@scope/ui',
      version: '0.0.1',
      type: 'module',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });
    project.writeFile(
      'packages/ui/auklet.config.js',
      `export const config = {
        source: 'src',
        modules: true,
        styles: { shared: { output: './src/shared/**/*.module.{less,css}' } },
      };`,
    );
    project.writeJson('packages/app/package.json', {
      name: '@scope/app',
      type: 'module',
      dependencies: { '@scope/ui': 'workspace:*' },
    });
    project.writeFile(
      'packages/app/auklet.config.js',
      `export const config = { source: 'src', modules: true };`,
    );
    const entryFile = project.writeFile(
      'packages/app/src/entry.ts',
      `import styles from '@scope/ui/shared/chip.module.less';\nexport const className = styles.chip;\n`,
    );

    const expectedClass = createGenerateScopedName({
      packageRoot: uiRoot,
      sourceRoot: path.join(uiRoot, 'src'),
    })('chip', moduleFile, '');
    const production = await compileCssModule({
      file: moduleFile,
      packageRoot: uiRoot,
      sourceRoot: path.join(uiRoot, 'src'),
    });
    expect(production.locals.chip).toBe(expectedClass);

    const plugin = aukletStylePlugin({ root: appRoot, mode: 'package' });
    const server = await createViteServer({
      configFile: false,
      logLevel: 'silent',
      root: appRoot,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [plugin],
    });

    try {
      const resolved = await server.pluginContainer.resolveId(
        '@scope/ui/shared/chip.module.less',
        entryFile,
      );
      expect(resolved?.id).toBe(toCssModuleVirtualId(moduleFile));

      await server.transformRequest('/src/entry.ts');
      await server.transformRequest(toCssModuleVirtualId(moduleFile));
      await server.transformRequest(toCssModuleStyleVirtualId(moduleFile));
      const loaded = await server.ssrLoadModule('/src/entry.ts');
      expect(loaded.className).toBe(expectedClass);

      project.writeFile(
        'packages/ui/src/shared/chip.module.less',
        '.chip { color: blue; }\n.label { color: green; }\n',
      );

      const hotUpdate = plugin.hotUpdate;
      const handler =
        typeof hotUpdate === 'object' && hotUpdate && 'handler' in hotUpdate
          ? hotUpdate.handler
          : hotUpdate;
      const modules = await handler?.call(
        { environment: server.environments.client } as never,
        {
          file: moduleFile,
          modules: [],
          server,
          timestamp: Date.now(),
          type: 'update',
          read: async () => fs.readFileSync(moduleFile, 'utf8'),
        } as never,
      );
      const ids = modules?.map((item) => item.id) ?? [];
      expect(ids).toEqual(
        expect.arrayContaining([
          toCssModuleVirtualId(moduleFile),
          toCssModuleStyleVirtualId(moduleFile),
        ]),
      );

      const next = await compileCssModule({
        file: moduleFile,
        packageRoot: uiRoot,
        sourceRoot: path.join(uiRoot, 'src'),
      });
      expect(next.locals.chip).toBe(expectedClass);
      expect(next.locals.label).toBe(
        createGenerateScopedName({
          packageRoot: uiRoot,
          sourceRoot: path.join(uiRoot, 'src'),
        })('label', moduleFile, ''),
      );
    } finally {
      await server.close();
    }
  });
});
