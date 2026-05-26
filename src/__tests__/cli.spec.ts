import { describe, expect, test } from 'vitest';
import { resolveBuildCliArgs } from '#auklet/cli';

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
