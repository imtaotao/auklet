import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { inspectPackageFiles } from '#auklet/publish/inspectPack';
import type { PublishTarget } from '#auklet/publish/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('inspectPackageFiles', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-inspect-pack-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('checks package entry fields, exports, bin, css entries, and files', () => {
    project.writeFiles({
      'dist/index.js': 'export {};\n',
      'dist/index.d.ts': 'export {};\n',
      'dist/index.css': '.root {}\n',
      'bin/entry.mjs': '#!/usr/bin/env node\n',
    });

    const checks = inspectPackageFiles([
      createTarget(project, {
        main: './dist/index.js',
        types: './dist/index.d.ts',
        style: './dist/index.css',
        bin: {
          demo: './bin/entry.mjs',
        },
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
          './missing': './dist/missing.js',
          './components/*': './dist/components/*.js',
        },
        files: ['dist', '!dist/__tests__'],
      }),
    ]);

    expect(
      checks.map((check) => ({
        field: check.field,
        file: check.file,
        status: check.status,
      })),
    ).toEqual([
      { field: 'main', file: './dist/index.js', status: 'exists' },
      { field: 'types', file: './dist/index.d.ts', status: 'exists' },
      { field: 'style', file: './dist/index.css', status: 'exists' },
      { field: 'bin.demo', file: './bin/entry.mjs', status: 'exists' },
      {
        field: 'exports["."].types',
        file: './dist/index.d.ts',
        status: 'exists',
      },
      {
        field: 'exports["."].default',
        file: './dist/index.js',
        status: 'exists',
      },
      {
        field: 'exports["./missing"]',
        file: './dist/missing.js',
        status: 'missing',
      },
      {
        field: 'exports["./components/*"]',
        file: './dist/components/*.js',
        status: 'pattern',
      },
      { field: 'files[0]', file: 'dist', status: 'exists' },
      { field: 'files[1]', file: '!dist/__tests__', status: 'skipped' },
    ]);
  });
});

const createTarget = (
  project: VirtualProject,
  packageJson: PublishTarget['packageJson'],
): PublishTarget => {
  return {
    packageRoot: project.root,
    packageName: '@scope/ui',
    version: '1.0.0',
    publishVersion: '1.0.0',
    private: false,
    kind: 'package',
    workspaceMode: 'single',
    packageJson,
  };
};
