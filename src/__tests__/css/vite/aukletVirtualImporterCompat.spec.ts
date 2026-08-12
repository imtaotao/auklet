import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { findPackageRootForFile } from '#auklet/css/core/resolvers/externalLess';
import { invalidateWorkspaceSharedOutputResolveCache } from '#auklet/css/modules/resolveWorkspaceSharedOutputModule';
import {
  toCssModuleVirtualId,
  toResolvedCssModuleStyleAssetVirtualId,
} from '#auklet/css/vite/cssModuleVirtualId';
import { toPackageStyleVirtualId } from '#auklet/css/vite/packageStyleVirtualId';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

const resolveHandler = (plugin: ReturnType<typeof aukletStylePlugin>) => {
  const resolveId = plugin.resolveId;
  return typeof resolveId === 'object' && resolveId && 'handler' in resolveId
    ? resolveId.handler
    : resolveId;
};

const resolvedIdOf = (resolved: unknown) =>
  typeof resolved === 'object' && resolved && 'id' in resolved
    ? String((resolved as { id: string }).id)
    : String(resolved);

const FOREIGN_IMPORTERS = [
  '\0virtual:mf:__mfe_internal__host__loadShare__react__loadShare__.js',
  '\0vite/preload-helper.js',
  '\0plugin-vue:export-helper',
] as const;

describe('auklet virtual importer compatibility after foreign-\\0 guard', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-virtual-importer-compat-');
    project.writePackageJson({ name: '@scope/app' });
  });

  afterEach(() => {
    invalidateWorkspaceSharedOutputResolveCache();
    project.cleanup();
  });

  test('CSS Modules virtual importer still resolves sibling module and stays on auklet virtual', async () => {
    const moduleFile = project.writeFile(
      'src/Button.module.css',
      '.button { color: red; }',
    );
    const sibling = project.writeFile(
      'src/Icon.module.css',
      '.icon { color: blue; }',
    );
    const plugin = aukletStylePlugin({ root: project.root });
    const handler = resolveHandler(plugin);
    const importer = toCssModuleVirtualId(moduleFile);

    const resolved = await handler?.call(plugin, './Icon.module.css', importer);
    expect(resolvedIdOf(resolved)).toBe(toCssModuleVirtualId(sibling));
  });

  test('package-style virtual id as source is still owned (not treated as foreign)', async () => {
    const cssFile = project.writeFile('src/shared/chip.css', '.chip {}');
    const plugin = aukletStylePlugin({ root: project.root });
    const handler = resolveHandler(plugin);
    const virtualId = toPackageStyleVirtualId(cssFile);

    await expect(
      handler?.call(plugin, virtualId, path.join(project.root, 'src/App.tsx')),
    ).resolves.toBe(virtualId);
  });

  test('auklet-css package virtual source still resolves', async () => {
    project.writeFile('src/index.css', '.app {}');
    const plugin = aukletStylePlugin({ root: project.root });
    const handler = resolveHandler(plugin);
    const id = '\0auklet-css:@scope/app/style.css';

    await expect(
      handler?.call(plugin, id, path.join(project.root, 'src/App.tsx')),
    ).resolves.toBe(id);
  });

  test('real TS importer CSS Modules path unchanged', async () => {
    const moduleFile = project.writeFile('src/Button.module.css', '.button {}');
    const plugin = aukletStylePlugin({ root: project.root });
    const handler = resolveHandler(plugin);

    const resolved = await handler?.call(
      plugin,
      './Button.module.css',
      path.join(project.root, 'src/Button.tsx'),
    );
    expect(resolvedIdOf(resolved)).toBe(toCssModuleVirtualId(moduleFile));
  });

  test('findPackageRootForFile no longer treats auklet virtual ids as cwd package roots', () => {
    const moduleFile = project.writeFile('src/Button.module.css', '.button {}');
    // Pre-fix walk eventually hit `.` + cwd package.json and returned `.`.
    expect(findPackageRootForFile(toCssModuleVirtualId(moduleFile))).toBeNull();
    expect(findPackageRootForFile(moduleFile)).toBe(project.root);
  });

  test('foreign importers reclaim owned auklet virtual sources (MF, vite, vue)', async () => {
    const moduleFile = project.writeFile('src/Button.module.css', '.button {}');
    const assetFile = project.writeFile('src/tokens.css', ':root { --x: 1; }');
    const cssFile = project.writeFile('src/shared/chip.css', '.chip {}');
    const plugin = aukletStylePlugin({ root: project.root });
    const handler = resolveHandler(plugin);
    const cssModuleVirtualId = toCssModuleVirtualId(moduleFile);
    const packageStyleVirtualId = toPackageStyleVirtualId(cssFile);
    const assetVirtualId = toResolvedCssModuleStyleAssetVirtualId(
      moduleFile,
      assetFile,
    );
    const packageCssVirtualId = '\0auklet-css:@scope/app/style.css';

    for (const foreignImporter of FOREIGN_IMPORTERS) {
      await expect(
        handler?.call(plugin, cssModuleVirtualId, foreignImporter),
      ).resolves.toBe(cssModuleVirtualId);
      await expect(
        handler?.call(plugin, packageStyleVirtualId, foreignImporter),
      ).resolves.toBe(packageStyleVirtualId);
      await expect(
        handler?.call(plugin, assetVirtualId, foreignImporter),
      ).resolves.toBe(assetVirtualId);
      await expect(
        handler?.call(plugin, packageCssVirtualId, foreignImporter),
      ).resolves.toBe(packageCssVirtualId);

      // Relative style imports must not use foreign virtuals as file anchors.
      await expect(
        handler?.call(plugin, './Button.module.css', foreignImporter),
      ).resolves.toBeNull();
      await expect(
        handler?.call(plugin, 'react', foreignImporter),
      ).resolves.toBeNull();
      await expect(
        handler?.call(
          plugin,
          foreignImporter,
          path.join(project.root, 'src/App.tsx'),
        ),
      ).resolves.toBeNull();
    }
  });

  test('css-module virtual importer remaps workspace shared.output package specifier', async () => {
    const uiRoot = project.resolve('packages/ui');
    const appRoot = project.resolve('packages/app');
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
    fs.mkdirSync(path.join(appRoot, 'node_modules/@scope'), {
      recursive: true,
    });
    fs.symlinkSync(uiRoot, path.join(appRoot, 'node_modules/@scope/ui'), 'dir');

    const consumerModule = project.writeFile(
      'packages/app/src/Widget.module.css',
      '.widget { color: black; }\n',
    );
    const plugin = aukletStylePlugin({ root: appRoot, mode: 'package' });
    const handler = resolveHandler(plugin);

    const resolved = await handler?.call(
      plugin,
      '@scope/ui/shared/chip.module.less',
      toCssModuleVirtualId(consumerModule),
    );
    expect(resolvedIdOf(resolved)).toBe(toCssModuleVirtualId(moduleFile));
  });
});
