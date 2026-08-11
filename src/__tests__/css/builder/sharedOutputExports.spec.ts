import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  checkSharedOutputExports,
  createSharedOutputEntries,
  toSharedOutputCssRelative,
} from '#auklet/css/core/style/sharedOutput';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('checkSharedOutputExports', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-shared-output-exports-');
  });

  afterEach(() => {
    project.cleanup();
  });

  const createModuleEntries = () => {
    project.writeFile('src/shared/chip.module.less', '.chip { color: red; }\n');
    return createSharedOutputEntries({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
      outputDir: 'dist',
      outputFormats: ['es', 'lib'],
      patterns: ['./src/shared/**/*.module.{less,css}'],
    });
  };

  test('passes when exportSubpath maps to the published JS shim', () => {
    const entries = createModuleEntries();
    project.writePackageJson({
      name: '@scope/ui',
      exports: {
        './shared/chip.module.less': {
          import: './dist/es/shared/chip.module.less.js',
          default: './dist/es/shared/chip.module.less.js',
        },
      },
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual([
      {
        exportSubpath: './shared/chip.module.less',
        exportTarget: './dist/es/shared/chip.module.less.js',
        expectedTargetRelative: 'dist/es/shared/chip.module.less.js',
        ok: true,
      },
    ]);
  });

  test('passes when plain css/less exports map to dist assets', () => {
    project.writeFile('src/shared/helpers.css', '.helper {}\n');
    project.writeFile('src/shared/tokens.less', '@brand-color: #111827;\n');
    const entries = createSharedOutputEntries({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
      outputDir: 'dist',
      outputFormats: ['es', 'lib'],
      patterns: ['./src/shared/**/*.{css,less}'],
    });
    project.writePackageJson({
      name: '@scope/ui',
      exports: {
        './shared/helpers.css': './dist/es/shared/helpers.css',
        './shared/tokens.less': {
          less: './dist/es/shared/tokens.less',
          default: './dist/es/shared/tokens.less',
        },
      },
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual(
      expect.arrayContaining([
        {
          exportSubpath: './shared/helpers.css',
          exportTarget: './dist/es/shared/helpers.css',
          expectedTargetRelative: 'dist/es/shared/helpers.css',
          ok: true,
        },
        {
          exportSubpath: './shared/tokens.less',
          exportTarget: './dist/es/shared/tokens.less',
          expectedTargetRelative: 'dist/es/shared/tokens.less',
          ok: true,
        },
      ]),
    );
  });

  test('fails when the subpath is missing from exports', () => {
    const entries = createModuleEntries();
    project.writePackageJson({
      name: '@scope/ui',
      exports: {
        '.': './dist/es/index.js',
      },
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual([
      {
        exportSubpath: './shared/chip.module.less',
        exportTarget: null,
        expectedTargetRelative: 'dist/es/shared/chip.module.less.js',
        ok: false,
        reason: 'subpath is not exported',
      },
    ]);
  });

  test('fails when export target points at source instead of the JS shim', () => {
    const entries = createModuleEntries();
    project.writePackageJson({
      name: '@scope/ui',
      exports: {
        './shared/chip.module.less': './src/shared/chip.module.less',
      },
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual([
      {
        exportSubpath: './shared/chip.module.less',
        exportTarget: './src/shared/chip.module.less',
        expectedTargetRelative: 'dist/es/shared/chip.module.less.js',
        ok: false,
        reason: 'export target should be ./dist/es/shared/chip.module.less.js',
      },
    ]);
  });

  test('fails when export target is a bare jsRelative without dist/es|lib', () => {
    const entries = createModuleEntries();
    project.writePackageJson({
      name: '@scope/ui',
      exports: {
        './shared/chip.module.less': './shared/chip.module.less.js',
      },
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual([
      {
        exportSubpath: './shared/chip.module.less',
        exportTarget: './shared/chip.module.less.js',
        expectedTargetRelative: 'dist/es/shared/chip.module.less.js',
        ok: false,
        reason: 'export target should be ./dist/es/shared/chip.module.less.js',
      },
    ]);
  });

  test('fails when package.json#exports is missing', () => {
    const entries = createModuleEntries();
    project.writePackageJson({
      name: '@scope/ui',
    });

    expect(
      checkSharedOutputExports({ packageRoot: project.root, entries }),
    ).toEqual([
      {
        exportSubpath: './shared/chip.module.less',
        exportTarget: null,
        expectedTargetRelative: 'dist/es/shared/chip.module.less.js',
        ok: false,
        reason: 'package.json#exports is missing',
      },
    ]);
  });
});

describe('shared.output scoped CSS naming', () => {
  test('rewrites *.module.* to *.scoped.css so consumers do not re-module', () => {
    expect(toSharedOutputCssRelative('shared/chip.module.less')).toBe(
      'shared/chip.scoped.css',
    );
    expect(toSharedOutputCssRelative('shared/chip.module.css')).toBe(
      'shared/chip.scoped.css',
    );
    expect(isCssModuleFile(path.join('/pkg', 'shared/chip.scoped.css'))).toBe(
      false,
    );
  });
});
