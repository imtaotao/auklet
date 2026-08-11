import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createPackageStyleImportPlugin } from '#auklet/build/packageStyleImportPlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('createPackageStyleImportPlugin', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-package-style-import-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('resolves exported package CSS to a synthetic *.css.js id', () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const cssFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/shared/helpers.css',
      },
    });

    const plugin = createPackageStyleImportPlugin({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });
    const resolved = plugin.resolveId.handler('@scope/ui/shared/helpers.css');

    expect(resolved).toBe(`${path.resolve(cssFile)}.js`);
  });

  test('load emits shared-package CSS asset and empty side-effect module', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const cssFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/shared/helpers.css',
      },
    });

    const plugin = createPackageStyleImportPlugin({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });
    const entryId = `${path.resolve(cssFile)}.js`;
    const emitted: Array<{ fileName: string; source: string }> = [];

    const loaded = await plugin.load.call(
      {
        emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
          emitted.push(asset);
        },
      },
      entryId,
    );

    expect(loaded).toEqual({
      code: 'export {};\n',
      moduleSideEffects: true,
    });
    expect(emitted).toEqual([
      {
        type: 'asset',
        fileName: 'shared-package/@scope/ui/dist/shared/helpers.css',
        source: '.helper { display: block; }\n',
      },
    ]);

    const rendered = plugin.renderChunk('export {};\n', {
      fileName: 'components/App/index.js',
      moduleIds: [entryId],
    });
    expect(rendered?.code).toBe(
      'import "../../shared-package/@scope/ui/dist/shared/helpers.css";\nexport {};\n',
    );
  });

  test('compiles exported package Less to CSS assets', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const lessFile = project.writeFile(
      'node_modules/@scope/ui/dist/shared/tokens.less',
      '@color: blue;\n.token { color: @color; }\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/tokens.less': {
          less: './dist/shared/tokens.less',
          default: './dist/shared/tokens.less',
        },
      },
    });

    const plugin = createPackageStyleImportPlugin({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });
    const entryId = `${path.resolve(lessFile)}.js`;
    const emitted: Array<{ fileName: string; source: string }> = [];

    await plugin.load.call(
      {
        emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
          emitted.push(asset);
        },
      },
      entryId,
    );

    expect(emitted[0]?.fileName).toBe(
      'shared-package/@scope/ui/dist/shared/tokens.css',
    );
    expect(emitted[0]?.source).toContain('.token');
    expect(emitted[0]?.source).toContain('color: blue');
  });

  test('injects require() side effects for CJS chunks', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    const cssFile = project.writeFile(
      'node_modules/@scope/ui/dist/helpers.css',
      '.helper {}\n',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './helpers.css': './dist/helpers.css',
      },
    });

    const plugin = createPackageStyleImportPlugin({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });
    const entryId = `${path.resolve(cssFile)}.js`;
    await plugin.load.call(
      {
        emitFile() {},
      },
      entryId,
    );

    const rendered = plugin.renderChunk(
      'exports.default = {};\n',
      {
        fileName: 'components/App/index.js',
        moduleIds: [entryId],
      },
      { format: 'cjs' },
    );

    expect(rendered?.code).toBe(
      'require("../../shared-package/@scope/ui/dist/helpers.css");\nexports.default = {};\n',
    );
  });

  test('ignores CSS Modules package imports', () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: { '@scope/ui': '0.0.1' },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './chip.module.css': './dist/chip.module.css',
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/chip.module.css',
      '.chip {}\n',
    );

    const plugin = createPackageStyleImportPlugin({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });
    expect(plugin.resolveId.handler('@scope/ui/chip.module.css')).toBeNull();
  });
});
