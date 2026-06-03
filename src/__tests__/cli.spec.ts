import { describe, expect, test } from 'vitest';
import { resolveBuildCliArgs } from '#auklet/cli/buildArgs';

describe('resolveBuildCliArgs', () => {
  test('extracts auklet config overrides and keeps non-auklet args', () => {
    expect(
      resolveBuildCliArgs([
        '--source',
        'source',
        '--output=build',
        '--modules',
        '--build.formats',
        'esm,cjs',
        '--build.target=es2022',
        '--build.platform',
        'node',
        '--build.tsconfig',
        'tsconfig.build.json',
        '--watch',
      ]),
    ).toEqual({
      args: ['--watch'],
      config: {
        source: 'source',
        output: 'build',
        modules: true,
        build: {
          formats: ['esm', 'cjs'],
          target: 'es2022',
          platform: 'node',
          tsconfig: 'tsconfig.build.json',
        },
      },
    });
  });

  test('supports disabling module output from cli args', () => {
    expect(resolveBuildCliArgs(['--no-modules'])).toEqual({
      args: [],
      config: {
        modules: false,
      },
    });
  });

  test('resolves env values for string config overrides', () => {
    const originalSource = process.env.AUKLET_TEST_SOURCE;
    const originalOutput = process.env.AUKLET_TEST_OUTPUT;

    try {
      process.env.AUKLET_TEST_SOURCE = 'source';
      process.env.AUKLET_TEST_OUTPUT = 'build';

      expect(
        resolveBuildCliArgs([
          '--source=env:AUKLET_TEST_SOURCE',
          '--output',
          'env:AUKLET_TEST_OUTPUT',
        ]),
      ).toEqual({
        args: [],
        config: {
          source: 'source',
          output: 'build',
        },
      });
    } finally {
      if (originalSource === undefined) {
        delete process.env.AUKLET_TEST_SOURCE;
      } else {
        process.env.AUKLET_TEST_SOURCE = originalSource;
      }
      if (originalOutput === undefined) {
        delete process.env.AUKLET_TEST_OUTPUT;
      } else {
        process.env.AUKLET_TEST_OUTPUT = originalOutput;
      }
    }
  });

  test('resolves env values for boolean config overrides', () => {
    const originalModules = process.env.AUKLET_TEST_MODULES;

    try {
      process.env.AUKLET_TEST_MODULES = 'false';

      expect(
        resolveBuildCliArgs(['--modules=env:AUKLET_TEST_MODULES']),
      ).toEqual({
        args: [],
        config: {
          modules: false,
        },
      });
    } finally {
      if (originalModules === undefined) {
        delete process.env.AUKLET_TEST_MODULES;
      } else {
        process.env.AUKLET_TEST_MODULES = originalModules;
      }
    }
  });

  test('rejects invalid env boolean values for config overrides', () => {
    const originalModules = process.env.AUKLET_TEST_MODULES;

    try {
      process.env.AUKLET_TEST_MODULES = 'maybe';

      expect(() =>
        resolveBuildCliArgs(['--modules=env:AUKLET_TEST_MODULES']),
      ).toThrow('--modules requires a boolean value.');
    } finally {
      if (originalModules === undefined) {
        delete process.env.AUKLET_TEST_MODULES;
      } else {
        process.env.AUKLET_TEST_MODULES = originalModules;
      }
    }
  });

  test('resolves env values before parsing build formats', () => {
    const originalFormats = process.env.AUKLET_TEST_FORMATS;

    try {
      process.env.AUKLET_TEST_FORMATS = 'esm,cjs';

      expect(
        resolveBuildCliArgs(['--build.formats=env:AUKLET_TEST_FORMATS']),
      ).toEqual({
        args: [],
        config: {
          build: {
            formats: ['esm', 'cjs'],
          },
        },
      });
    } finally {
      if (originalFormats === undefined) {
        delete process.env.AUKLET_TEST_FORMATS;
      } else {
        process.env.AUKLET_TEST_FORMATS = originalFormats;
      }
    }
  });

  test('reports missing env values for config overrides', () => {
    expect(() =>
      resolveBuildCliArgs(['--source=env:AUKLET_TEST_MISSING_SOURCE']),
    ).toThrow('--source environment is missing: AUKLET_TEST_MISSING_SOURCE');
  });

  test('rejects unknown build formats', () => {
    expect(() => resolveBuildCliArgs(['--build.formats', 'umd'])).toThrow(
      'Unknown build format: umd',
    );
  });

  test('rejects auklet config overrides with custom tsdown config', () => {
    expect(() =>
      resolveBuildCliArgs([
        '--source',
        'source',
        '--config',
        'tsdown.config.ts',
      ]),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
    expect(() =>
      resolveBuildCliArgs([
        '--build.target',
        'es2022',
        '-c',
        'tsdown.config.ts',
      ]),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
    expect(() =>
      resolveBuildCliArgs(['--output', 'build', '--no-config']),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
  });

  test('allows custom tsdown config without auklet config overrides', () => {
    expect(resolveBuildCliArgs(['--config', 'tsdown.config.ts'])).toEqual({
      args: ['--config', 'tsdown.config.ts'],
      config: {},
    });
  });
});
