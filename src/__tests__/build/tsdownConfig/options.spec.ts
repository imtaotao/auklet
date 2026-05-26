import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineKernelPackageConfigFromOptions } from '#auklet/build/tsdownConfig';
import type { VirtualProject } from '../../fixtures/virtualProject';
import { createTsdownProject, writeModuleEntries } from './helpers';

describe('defineKernelPackageConfigFromOptions', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createTsdownProject();
  });

  afterEach(() => {
    vi.useRealTimers();
    project.cleanup();
  });

  test('maps auk build options to bundle and module tsdown configs', () => {
    writeModuleEntries(project);

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      modules: true,
      build: {
        formats: ['esm'],
        alias: {
          '@fixture/shared': './src/shared',
        },
        externals: ['@scope/external'],
        tsconfig: 'tsconfig.package.json',
      },
    });

    expect(configs).toHaveLength(4);
    expect(configs[0]).toMatchObject({
      cwd: project.root,
      root: project.root,
      entry: {
        index: 'src/index.ts',
      },
      format: 'esm',
      outDir: 'dist',
      dts: true,
      platform: 'neutral',
      target: 'es2020',
      tsconfig: path.join(project.root, 'tsconfig.package.json'),
      alias: {
        '@fixture/shared': './src/shared',
      },
      deps: {
        neverBundle: [
          'aidly',
          'aidly/*',
          'react',
          'react/*',
          'kleur',
          'kleur/*',
          '@scope/dev-tool',
          '@scope/dev-tool/*',
          '@scope/external',
          '@scope/external/*',
        ],
      },
      outputOptions: {
        entryFileNames: '[name].js',
      },
    });
    expect(configs[1]).toMatchObject({
      format: 'esm',
      dts: false,
      outputOptions: {
        entryFileNames: '[name].mjs',
      },
    });
    expect(configs[1].inputOptions).toBeUndefined();
    expect(configs[2]).toMatchObject({
      entry: {
        'components/Button/index': 'src/components/Button/index.tsx',
        index: 'src/index.ts',
      },
      format: 'esm',
      outDir: 'dist/es',
      dts: true,
      target: 'es2020',
      alias: {
        '@fixture/shared': './src/shared',
      },
      deps: {
        neverBundle: [
          'aidly',
          'aidly/*',
          'react',
          'react/*',
          'kleur',
          'kleur/*',
          '@scope/dev-tool',
          '@scope/dev-tool/*',
          '@scope/external',
          '@scope/external/*',
        ],
      },
      unbundle: true,
    });
    expect(configs[2].inputOptions).toBeUndefined();
    expect(configs[3]).toMatchObject({
      format: 'cjs',
      outDir: 'dist/lib',
      dts: true,
      target: 'es2020',
      unbundle: true,
    });
  });

  test('uses custom build target for bundle and module configs', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      modules: true,
      build: {
        formats: ['iife'],
        target: 'es2022',
      },
    });

    expect(configs.map((config) => config.target)).toEqual([
      'es2022',
      'es2022',
      'es2022',
    ]);
  });

  test('omits the banner author line when package author is missing', () => {
    project.writePackageJson({
      name: 'fixture-package',
      version: '1.2.3',
    });

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['cjs'],
      },
    });

    expect(configs[0]).toMatchObject({
      banner: '/*!\n * fixture-package.js v1.2.3\n */',
    });
  });

  test('uses current build year in the default banner author line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['cjs'],
      },
    });

    expect(configs[0]).toMatchObject({
      banner:
        '/*!\n' +
        ' * @scope/fixture-package.js v1.2.3\n' +
        ' * (c) 2030 tester\n' +
        ' */',
    });
  });

  test('uses custom banner from auk build options', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['cjs'],
        banner: '/* custom banner */',
      },
    });

    expect(configs[0]).toMatchObject({
      banner: '/* custom banner */',
    });
  });

  test('uses custom build platform', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['cjs'],
        platform: 'node',
      },
    });

    expect(configs[0]).toMatchObject({
      platform: 'node',
    });
  });

  test('uses custom output directory for bundle and module configs', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      output: 'build',
      modules: true,
      build: {
        formats: ['cjs'],
      },
    });

    expect(configs[0]).toMatchObject({
      outDir: 'build',
    });
    expect(configs[1]).toMatchObject({
      outDir: path.join('build', 'es'),
    });
    expect(configs[2]).toMatchObject({
      outDir: path.join('build', 'lib'),
    });
  });

  test('uses custom source directory for bundle and module configs', () => {
    project.writeFile('source/index.ts', 'export const value = 1;');
    project.writeFile(
      'source/components/Button/index.tsx',
      'export function Button() { return null; }',
    );

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      source: 'source',
      modules: true,
      build: {
        formats: ['cjs'],
      },
    });

    expect(configs[0]).toMatchObject({
      entry: {
        index: 'source/index.ts',
      },
    });
    expect(configs[1]).toMatchObject({
      entry: {
        'components/Button/index': 'source/components/Button/index.tsx',
        index: 'source/index.ts',
      },
    });
  });

  test('uses tsx package entry when ts entry is missing', () => {
    project.writeFile(
      'src/index.tsx',
      'export function Component() { return null; }',
    );

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['esm'],
      },
    });

    expect(configs[0]).toMatchObject({
      entry: {
        index: 'src/index.tsx',
      },
    });
  });

  test('uses custom main fields for non-iife bundle configs', async () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['esm'],
        mainFields: ['module', 'main'],
      },
    });
    const inputOptions = configs[0].inputOptions;

    expect(inputOptions).toEqual(expect.any(Function));
    if (typeof inputOptions !== 'function') {
      throw new Error('Expected bundle config to define inputOptions');
    }
    await expect(
      Promise.resolve(inputOptions({ resolve: {} }, 'es', { cjsDts: false })),
    ).resolves.toMatchObject({
      resolve: {
        mainFields: ['module', 'main'],
      },
    });
  });
});
