import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

vi.mock('tsdown/config', () => ({
  defineConfig: vi.fn((config: unknown) => config),
}));

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
      entry: ['src/index.ts'],
      format: 'esm',
      outDir: 'dist',
      dts: false,
      tsconfig: path.join(project.root, 'tsconfig.package.json'),
      deps: {
        neverBundle: [
          'aidly',
          'aidly/*',
          'react',
          'react/*',
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
      outputOptions: {
        entryFileNames: '[name].mjs',
      },
    });
    expect(configs[2]).toMatchObject({
      entry: [
        'src/**/*.ts',
        'src/**/*.tsx',
        '!src/**/*.d.ts',
        '!src/**/__tests__/**',
        '!src/**/*.spec.ts',
        '!src/**/*.spec.tsx',
      ],
      format: 'esm',
      outDir: 'dist/es',
      dts: true,
      deps: {
        neverBundle: [
          'aidly',
          'aidly/*',
          'react',
          'react/*',
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
      unbundle: true,
    });
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

  test('merges manual externals into iife peer externals', () => {
    const configs = defineKernelPackageConfigFromOptions(project.root, {
      build: {
        formats: ['iife'],
        externals: ['react-dom'],
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
          react: 'React',
          'react-dom': 'ReactDom',
        },
      },
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
