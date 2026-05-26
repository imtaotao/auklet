import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineKernelPackageConfigFromFile } from '#auklet/build/tsdownConfig';
import {
  aukletCliConfigOverridesEnv,
  encodeAukletCliConfigOverrides,
} from '#auklet/build/cliOverrides';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

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
    delete process.env[aukletCliConfigOverridesEnv];
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

  test('applies cli config overrides after package config', async () => {
    project.writeFile(
      'auklet.config.ts',
      `
        export const config = {
          output: 'dist',
          modules: false,
          build: {
            formats: ['cjs'],
            target: 'es2020',
            platform: 'neutral',
          },
        };
      `,
    );
    project.writeFile('source/index.ts', 'export const value = 1;');
    project.writeFile('tsconfig.build.json', '{}');
    process.env[aukletCliConfigOverridesEnv] = encodeAukletCliConfigOverrides({
      source: 'source',
      output: 'build',
      modules: true,
      build: {
        formats: ['esm'],
        target: 'es2022',
        platform: 'node',
        tsconfig: 'tsconfig.build.json',
      },
    });

    const configs = await defineKernelPackageConfigFromFile(project.root);

    expect(configs).toHaveLength(4);
    expect(configs[0]).toMatchObject({
      entry: {
        index: 'source/index.ts',
      },
      format: 'esm',
      outDir: 'build',
      target: 'es2022',
      platform: 'node',
      tsconfig: project.resolve('tsconfig.build.json'),
    });
    expect(configs[2]).toMatchObject({
      entry: {
        index: 'source/index.ts',
      },
      outDir: 'build/es',
      target: 'es2022',
      platform: 'node',
    });
  });
});
