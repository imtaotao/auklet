import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { compileCssModule } from '#auklet/css/modules/compileCssModule';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('cross-package shared style sources', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-package-shared-style-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('CSS Modules can import exported package CSS as a style asset', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/shared/helpers.css',
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/shared/helpers.css',
      '.helper { display: block; }\n',
    );
    const moduleFile = project.writeFile(
      'src/Button.module.css',
      '@import "@scope/ui/shared/helpers.css";\n.button { color: red; }\n',
    );

    const result = await compileCssModule({
      file: moduleFile,
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });

    expect(result.css).toContain('@import');
    expect(
      result.styleAssets.map((asset) => path.basename(asset.file)),
    ).toEqual(['helpers.css']);
    expect(result.styleAssets[0]?.css).toContain('.helper');
    expect(result.dependencyFiles).toEqual(
      expect.arrayContaining([
        path.join(project.root, 'package.json'),
        path.resolve(
          project.root,
          'node_modules/@scope/ui/dist/shared/helpers.css',
        ),
      ]),
    );
  });

  test('rejects exported package Less without (reference) from CSS Modules', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/tokens.less': {
          less: './dist/shared/tokens.less',
          source: './dist/shared/tokens.less',
          default: './dist/shared/tokens.less',
        },
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/shared/tokens.less',
      '@color: blue;\n.token { color: @color; }\n',
    );
    const moduleFile = project.writeFile(
      'src/Button.module.less',
      '@import "@scope/ui/shared/tokens.less";\n.button { color: red; }\n',
    );

    await expect(
      compileCssModule({
        file: moduleFile,
        packageRoot: project.root,
        sourceRoot: project.resolve('src'),
      }),
    ).rejects.toThrow(/external Less imports must use \(reference\)/);
  });

  test('CSS Modules can import exported package Less with (reference)', async () => {
    project.writePackageJson({
      name: '@scope/app',
      dependencies: {
        '@scope/ui': '0.0.1',
      },
    });
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './shared/tokens.less': {
          less: './dist/shared/tokens.less',
          source: './dist/shared/tokens.less',
          default: './dist/shared/tokens.less',
        },
      },
    });
    project.writeFile(
      'node_modules/@scope/ui/dist/shared/tokens.less',
      '@color: blue;\n.token-color() { color: @color; }\n',
    );
    const moduleFile = project.writeFile(
      'src/Button.module.less',
      '@import (reference) "@scope/ui/shared/tokens.less";\n.button { .token-color(); }\n',
    );

    const result = await compileCssModule({
      file: moduleFile,
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    });

    expect(result.scopedCss).toContain('color: blue');
    expect(
      result.styleAssets.some((asset) => asset.css.includes('.token')),
    ).toBe(false);
  });
});
