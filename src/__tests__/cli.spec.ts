import { describe, expect, test } from 'vitest';
import { AukletEnvContext } from '#auklet/env';
import {
  buildOverrideOptions,
  inspectOptions,
  workspaceOptions,
} from '#auklet/cli/help';
import { parseBuildOverrideArgs } from '#auklet/cli/parse/build';
import { parseWorkspaceSelectionArgs } from '#auklet/cli/parse/workspace';

const parseBuildOverrides = (args: Array<string>) => {
  return parseBuildOverrideArgs(args, new AukletEnvContext(process.cwd()));
};

const parseWorkspaceSelection = (args: Array<string>) => {
  return parseWorkspaceSelectionArgs(args, new AukletEnvContext(process.cwd()));
};

const optionFlags = (options: ReadonlyArray<readonly [string, string]>) => {
  return options.map(([flag]) => flag);
};

describe('cli help metadata', () => {
  test('lists key build override and workspace flags', () => {
    expect(optionFlags(buildOverrideOptions)).toContain('--source <dir>');
    expect(optionFlags(workspaceOptions)).toContain('--private [value]');
  });

  test('lists inspect fallback flags from publish, pack, and css', () => {
    const flags = optionFlags(inspectOptions);

    expect(flags).toContain('--version <value>');
    expect(flags).toContain('--filter <pattern>');
    expect(flags).toContain('--source <dir>');
  });
});

describe('parseBuildOverrideArgs', () => {
  test('extracts auklet config overrides and keeps non-auklet args', () => {
    expect(
      parseBuildOverrides([
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
    expect(parseBuildOverrides(['--no-modules'])).toEqual({
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
        parseBuildOverrides([
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
        parseBuildOverrides(['--modules=env:AUKLET_TEST_MODULES']),
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
        parseBuildOverrides(['--modules=env:AUKLET_TEST_MODULES']),
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
        parseBuildOverrides(['--build.formats=env:AUKLET_TEST_FORMATS']),
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
      parseBuildOverrides(['--source=env:AUKLET_TEST_MISSING_SOURCE']),
    ).toThrow('--source environment is missing: AUKLET_TEST_MISSING_SOURCE');
  });

  test('rejects unknown build formats', () => {
    expect(() => parseBuildOverrides(['--build.formats', 'umd'])).toThrow(
      'Unknown build format: umd',
    );
  });

  test('rejects empty build formats', () => {
    expect(() => parseBuildOverrides(['--build.formats='])).toThrow(
      '--build.formats requires at least one format.',
    );
  });

  test('rejects auklet config overrides with custom tsdown config', () => {
    expect(() =>
      parseBuildOverrides([
        '--source',
        'source',
        '--config',
        'tsdown.config.ts',
      ]),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
    expect(() =>
      parseBuildOverrides([
        '--build.target',
        'es2022',
        '-c',
        'tsdown.config.ts',
      ]),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
    expect(() =>
      parseBuildOverrides(['--output', 'build', '--no-config']),
    ).toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );
  });

  test('allows custom tsdown config without auklet config overrides', () => {
    expect(parseBuildOverrides(['--config', 'tsdown.config.ts'])).toEqual({
      args: ['--config', 'tsdown.config.ts'],
      config: {},
    });
  });
});

describe('parseWorkspaceSelectionArgs', () => {
  test('extracts workspace filters and keeps build args', () => {
    expect(
      parseWorkspaceSelection([
        '--workspace',
        '--filter',
        '*',
        '--filter=@scope/ui',
        '--deps',
        '--source',
        'source',
        '--minify',
      ]),
    ).toEqual({
      remainingArgs: ['--source', 'source', '--minify'],
      workspace: {
        filters: ['*', '@scope/ui'],
        includeDependencies: true,
        includePrivate: false,
      },
    });
  });

  test('resolves explicit deps boolean values', () => {
    expect(
      parseWorkspaceSelection(['--filter', '@scope/ui', '--deps=false']),
    ).toEqual({
      remainingArgs: [],
      workspace: {
        filters: ['@scope/ui'],
        includeDependencies: false,
        includePrivate: false,
      },
    });
  });

  test('resolves env values for workspace selector options', () => {
    const originalDeps = process.env.AUKLET_TEST_DEPS;
    const originalPrivate = process.env.AUKLET_TEST_PRIVATE;

    try {
      process.env.AUKLET_TEST_DEPS = 'true';
      process.env.AUKLET_TEST_PRIVATE = 'true';

      expect(
        parseWorkspaceSelection([
          '--filter',
          '@scope/ui',
          '--deps=env:AUKLET_TEST_DEPS',
          '--private=env:AUKLET_TEST_PRIVATE',
        ]),
      ).toEqual({
        remainingArgs: [],
        workspace: {
          filters: ['@scope/ui'],
          includeDependencies: true,
          includePrivate: true,
        },
      });
    } finally {
      if (originalDeps === undefined) {
        delete process.env.AUKLET_TEST_DEPS;
      } else {
        process.env.AUKLET_TEST_DEPS = originalDeps;
      }
      if (originalPrivate === undefined) {
        delete process.env.AUKLET_TEST_PRIVATE;
      } else {
        process.env.AUKLET_TEST_PRIVATE = originalPrivate;
      }
    }
  });

  test('reports missing filter values', () => {
    expect(() => parseWorkspaceSelection(['--filter'])).toThrow(
      '--filter requires a value.',
    );
  });

  test('rejects workspace values', () => {
    expect(() => parseWorkspaceSelection(['--workspace=true'])).toThrow(
      '--workspace does not accept a value.',
    );
  });
});
