import { beforeEach, describe, expect, test, vi } from 'vitest';
import { aukletCliConfigOverridesEnv } from '#auklet/build/cliOverrides';

const mocks = vi.hoisted(() => {
  const cssWatch = vi.fn().mockResolvedValue(undefined);
  const cssClose = vi.fn().mockResolvedValue(undefined);
  const cssWatcherContexts: Array<Record<string, unknown>> = [];
  const createCssWatcher = vi.fn(function createCssWatcher(
    context: Record<string, unknown>,
  ) {
    cssWatcherContexts.push(context);
    return {
      close: cssClose,
      watch: cssWatch,
    };
  });
  const jsKill = vi.fn();
  const execa = vi.fn(() =>
    Object.assign(Promise.resolve({ exitCode: 0 }), {
      kill: jsKill,
    }),
  );
  const loadAukletConfig = vi.fn().mockResolvedValue({
    modules: false,
    output: 'dist',
    source: 'src',
  });
  const resolveWorkspaceBuildTargets = vi.fn();

  return {
    createCssWatcher,
    cssClose,
    cssWatch,
    cssWatcherContexts,
    execa,
    jsKill,
    loadAukletConfig,
    resolveWorkspaceBuildTargets,
  };
});

vi.mock('execa', () => ({
  execa: mocks.execa,
}));

vi.mock('#auklet/configLoader', () => ({
  loadAukletConfig: mocks.loadAukletConfig,
}));

vi.mock('#auklet/css/watch/watcher', () => ({
  ModuleStyleWatcher: mocks.createCssWatcher,
}));

vi.mock('#auklet/cli/buildWorkspace', () => ({
  getWorkspacePackageScript: (
    packageJson: { scripts?: Record<string, string> },
    name: string,
  ) => packageJson.scripts?.[name] ?? null,
  resolveWorkspaceBuildTargets: mocks.resolveWorkspaceBuildTargets,
}));

vi.mock('#auklet/logger', () => ({
  createAukletLogger: () => ({
    child: () => ({
      success: vi.fn(),
    }),
    group: async (_title: string, callback: () => Promise<unknown>) =>
      callback(),
  }),
}));

import { runDev } from '#auklet/cli/dev';

describe('runDev', () => {
  beforeEach(() => {
    mocks.createCssWatcher.mockClear();
    mocks.cssClose.mockClear();
    mocks.cssWatch.mockClear();
    mocks.cssWatcherContexts.length = 0;
    mocks.execa.mockClear();
    mocks.jsKill.mockClear();
    mocks.loadAukletConfig.mockClear();
    mocks.resolveWorkspaceBuildTargets.mockClear();
  });

  test('passes build overrides to JavaScript watch env and CSS watcher config', async () => {
    await runDev(['--source', 'source', '--modules']);

    const [, , options] = mocks.execa.mock.calls[0] as unknown as [
      string,
      Array<string>,
      { env?: Record<string, string> },
    ];
    expect(
      JSON.parse(options.env?.[aukletCliConfigOverridesEnv] ?? '{}'),
    ).toEqual({
      modules: true,
      source: 'source',
    });
    expect(mocks.cssWatcherContexts[0]).toEqual({
      aukletConfig: {
        modules: true,
        output: 'dist',
        source: 'source',
      },
      packageRoot: process.cwd(),
    });
  });

  test('passes unknown tsdown args to JavaScript watch', async () => {
    await runDev(['--minify', '--sourcemap', '--source', 'source']);

    const [, args] = mocks.execa.mock.calls[0] as unknown as [
      string,
      Array<string>,
    ];
    expect(args).toEqual(
      expect.arrayContaining(['--minify', '--sourcemap', '--watch']),
    );
    expect(args).not.toContain('--source');
    expect(args).not.toContain('source');
  });

  test('rejects custom tsdown config with auklet build overrides', async () => {
    await expect(
      runDev(['--source', 'source', '--config', 'tsdown.config.ts']),
    ).rejects.toThrow(
      'Auklet build config flags cannot be used with tsdown --config, -c, or --no-config.',
    );

    expect(mocks.execa).not.toHaveBeenCalled();
    expect(mocks.createCssWatcher).not.toHaveBeenCalled();
  });

  test('closes CSS watcher when JavaScript watch exits', async () => {
    await runDev(['--source', 'source', '--modules']);

    expect(mocks.cssWatch).toHaveBeenCalledTimes(1);
    expect(mocks.jsKill).toHaveBeenCalledWith('SIGTERM');
    expect(mocks.cssClose).toHaveBeenCalledTimes(1);
  });

  test('starts workspace dev watchers for filtered packages', async () => {
    mocks.resolveWorkspaceBuildTargets.mockResolvedValue([
      {
        packageName: '@scope/theme',
        packageRoot: '/repo/packages/theme',
        packageJson: {
          scripts: {
            build: 'auk build-css',
          },
        },
      },
      {
        packageName: '@scope/ui',
        packageRoot: '/repo/packages/ui',
        packageJson: {},
      },
    ]);

    await runDev(['--filter', '*', '--source', 'source']);

    expect(mocks.resolveWorkspaceBuildTargets).toHaveBeenCalledWith(
      process.cwd(),
      ['*'],
      expect.anything(),
    );
    expect(mocks.execa).toHaveBeenCalledTimes(1);
    expect(mocks.execa).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--watch']),
      expect.objectContaining({
        cwd: '/repo/packages/ui',
      }),
    );
    expect(mocks.cssWatcherContexts).toEqual([
      {
        aukletConfig: {
          modules: false,
          output: 'dist',
          source: 'source',
        },
        packageRoot: '/repo/packages/theme',
      },
      {
        aukletConfig: {
          modules: false,
          output: 'dist',
          source: 'source',
        },
        packageRoot: '/repo/packages/ui',
      },
    ]);
    expect(mocks.cssClose).toHaveBeenCalledTimes(2);
  });

  test('uses package dev scripts for workspace dev targets', async () => {
    mocks.resolveWorkspaceBuildTargets.mockResolvedValue([
      {
        packageName: '@scope/app',
        packageRoot: '/repo/packages/app',
        packageJson: {
          scripts: {
            dev: 'vite',
          },
        },
      },
    ]);

    await runDev(['--workspace', '--host', '127.0.0.1']);

    expect(mocks.execa).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'dev', '--', '--host', '127.0.0.1'],
      expect.objectContaining({
        cwd: '/repo/packages/app',
        env: {
          AUKLET_WORKSPACE_DEV: '1',
        },
      }),
    );
    expect(mocks.createCssWatcher).not.toHaveBeenCalled();
  });

  test.each([
    'auklet build-css',
    'NODE_ENV=development auk build-css',
    'cross-env NODE_ENV=development auk build-css --watch',
  ])(
    'detects CSS-only workspace dev target from build script: %s',
    async (buildScript) => {
      mocks.resolveWorkspaceBuildTargets.mockResolvedValue([
        {
          packageName: '@scope/theme',
          packageRoot: '/repo/packages/theme',
          packageJson: {
            scripts: {
              build: buildScript,
            },
          },
        },
        {
          packageName: '@scope/app',
          packageRoot: '/repo/packages/app',
          packageJson: {
            scripts: {
              dev: 'vite',
            },
          },
        },
      ]);

      await runDev(['--workspace']);

      expect(mocks.execa).toHaveBeenCalledTimes(1);
      expect(mocks.execa).toHaveBeenCalledWith(
        'pnpm',
        ['run', 'dev'],
        expect.objectContaining({
          cwd: '/repo/packages/app',
        }),
      );
      expect(mocks.cssWatcherContexts).toEqual([
        {
          aukletConfig: {
            modules: false,
            output: 'dist',
            source: 'src',
          },
          packageRoot: '/repo/packages/theme',
        },
      ]);
    },
  );

  test('does not treat build-css-prefixed commands as CSS-only workspace dev targets', async () => {
    mocks.resolveWorkspaceBuildTargets.mockResolvedValue([
      {
        packageName: '@scope/theme',
        packageRoot: '/repo/packages/theme',
        packageJson: {
          scripts: {
            build: 'auk build-css-extra',
          },
        },
      },
    ]);

    await runDev(['--workspace']);

    expect(mocks.execa).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--watch']),
      expect.objectContaining({
        cwd: '/repo/packages/theme',
      }),
    );
    expect(mocks.cssWatcherContexts).toEqual([
      {
        aukletConfig: {
          modules: false,
          output: 'dist',
          source: 'src',
        },
        packageRoot: '/repo/packages/theme',
      },
    ]);
  });

  test('rejects recursive workspace dev', async () => {
    const originalValue = process.env.AUKLET_WORKSPACE_DEV;
    process.env.AUKLET_WORKSPACE_DEV = '1';

    try {
      await expect(runDev(['--workspace'])).rejects.toThrow(
        'recursive workspace dev detected',
      );
    } finally {
      if (originalValue === undefined) {
        delete process.env.AUKLET_WORKSPACE_DEV;
      } else {
        process.env.AUKLET_WORKSPACE_DEV = originalValue;
      }
    }

    expect(mocks.resolveWorkspaceBuildTargets).not.toHaveBeenCalled();
    expect(mocks.execa).not.toHaveBeenCalled();
  });
});
