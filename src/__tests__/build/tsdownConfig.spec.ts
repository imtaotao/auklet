import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

import {
  defineKernelPackageConfigFromFile,
  defineKernelPackageConfigFromOptions,
} from '#auklet/build/tsdownConfig';

describe('defineKernelPackageConfigFromOptions', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-tsdown-');
    project.writePackageJson({
      name: '@scope/fixture-package',
      version: '1.2.3',
      author: 'tester',
      dependencies: {
        aidly: '^1.0.0',
      },
      optionalDependencies: {
        kleur: '^4.0.0',
      },
      devDependencies: {
        '@scope/dev-tool': '^1.0.0',
      },
      peerDependencies: {
        react: '^19.0.0',
      },
    });
    project.writeFile('tsconfig.package.json', '{}');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('maps auk build options to bundle and module tsdown configs', () => {
    project.writeFiles({
      'src/index.ts': 'export const value = 1;',
      'src/components/Button/index.tsx':
        'export function Button() { return null; }',
      'src/components/Button/index.spec.tsx': 'export const ignored = true;',
      'src/types.d.ts': 'export type Ignored = string;',
      'src/__tests__/fixture.ts': 'export const ignored = true;',
    });

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      modules: true,
      build: {
        formats: ['esm'],
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
    expect(configs[2]).toMatchObject({
      entry: {
        'components/Button/index': 'src/components/Button/index.tsx',
        index: 'src/index.ts',
      },
      format: 'esm',
      outDir: 'dist/es',
      dts: true,
      target: 'es2020',
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

  test('merges manual externals into iife peer externals', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['iife'],
        externals: ['react-dom'],
        globals: {
          react: 'ReactRuntime',
          'react-dom': 'ReactDOM',
        },
      },
    });

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      format: 'iife',
      deps: {
        neverBundle: ['react', 'react-dom'],
        alwaysBundle: ['aidly', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
        onlyBundle: false,
      },
      outputOptions: {
        globals: {
          react: 'ReactRuntime',
          'react-dom': 'ReactDOM',
        },
      },
    });
  });

  test('allows final tsdown config customization', () => {
    const configureTsdown = vi.fn((config, context) => {
      return {
        ...config,
        name: `${context.kind}:${context.format}:${context.packageName}`,
        sourcemap: context.kind === 'bundle',
        outputOptions: {
          ...config.outputOptions,
          globals: {
            ...config.outputOptions?.globals,
            react: 'CustomReact',
          },
        },
      };
    });

    const configs = defineKernelPackageConfigFromOptions(project.root, {
      modules: true,
      build: {
        formats: ['iife'],
        configureTsdown,
      },
    });

    expect(configureTsdown).toHaveBeenCalledTimes(3);
    expect(configureTsdown.mock.calls.map(([, context]) => context)).toEqual([
      {
        kind: 'bundle',
        format: 'iife',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
      {
        kind: 'module',
        format: 'esm',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
      {
        kind: 'module',
        format: 'cjs',
        packageRoot: project.root,
        output: 'dist',
        packageName: '@scope/fixture-package',
      },
    ]);
    expect(configs[0]).toMatchObject({
      name: 'bundle:iife:@scope/fixture-package',
      sourcemap: true,
      outputOptions: {
        globals: {
          react: 'CustomReact',
        },
      },
    });
    expect(configs[1]).toMatchObject({
      name: 'module:esm:@scope/fixture-package',
      sourcemap: false,
    });
  });
});

describe('defineKernelPackageConfigFromFile', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-tsdown-file-');
    project.writePackageJson({
      name: 'fixture-package',
      version: '1.0.0',
    });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('loads auklet config from the package root', async () => {
    project.writeFile(
      'auklet.config.ts',
      `
        export const config = {
          build: {
            formats: ['cjs'],
          },
        };
      `,
    );

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(project.root);
    try {
      const configs = await defineKernelPackageConfigFromFile();
      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        cwd: project.root,
        format: 'cjs',
        outDir: 'dist',
      });
    } finally {
      cwd.mockRestore();
    }
  });
});
