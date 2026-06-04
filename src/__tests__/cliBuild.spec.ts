import { beforeEach, describe, expect, test, vi } from 'vitest';
import { aukletCliConfigOverridesEnv } from '#auklet/build/cliOverrides';
import { AukletEnvContext } from '#auklet/env';
import { parseBuildCommand } from '#auklet/cli/parse/build';

const mocks = vi.hoisted(() => {
  const cleanAukletOutputByConfig = vi.fn();
  const loadAukletConfig = vi.fn().mockResolvedValue({
    output: 'lib',
    source: 'src',
    build: {
      target: 'es2020',
    },
  });
  const execa = vi.fn().mockResolvedValue({ exitCode: 0 });
  const runBuildCss = vi.fn().mockResolvedValue(0);
  const runTsdown = vi.fn().mockResolvedValue(0);
  const resolveWorkspaceScriptTargets = vi.fn();

  return {
    cleanAukletOutputByConfig,
    execa,
    loadAukletConfig,
    resolveWorkspaceScriptTargets,
    runBuildCss,
    runTsdown,
  };
});

vi.mock('execa', () => ({
  execa: mocks.execa,
}));

vi.mock('#auklet/build/cleanOutput', () => ({
  cleanAukletOutputByConfig: mocks.cleanAukletOutputByConfig,
}));

vi.mock('#auklet/build/runTsdown', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#auklet/build/runTsdown')>();
  return {
    ...actual,
    runTsdown: mocks.runTsdown,
  };
});

vi.mock('#auklet/configLoader', () => ({
  loadAukletConfig: mocks.loadAukletConfig,
}));

vi.mock('#auklet/cli/buildCss', () => ({
  runBuildCss: mocks.runBuildCss,
}));

vi.mock('#auklet/cli/workspaceScripts', () => ({
  getWorkspacePackageScript: (
    packageJson: { scripts?: Record<string, string> },
    name: string,
  ) => packageJson.scripts?.[name] ?? null,
  resolveWorkspaceScriptTargets: mocks.resolveWorkspaceScriptTargets,
}));

vi.mock('#auklet/logger', () => ({
  createAukletLogger: () => ({
    group: async (_title: string, callback: () => Promise<unknown>) =>
      callback(),
    newline: vi.fn(),
  }),
}));

import { runBuild } from '#auklet/cli/build';

const parseTestBuildCommand = (args: Array<string>) => {
  return parseBuildCommand(args, {
    cwd: process.cwd(),
    envContext: new AukletEnvContext(process.cwd()),
  });
};

describe('runBuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses the same CLI override config for JavaScript and CSS builds', async () => {
    await expect(
      runBuild(
        parseTestBuildCommand([
          '--source',
          'source',
          '--modules',
          '--build.target',
          'es2022',
          '--minify',
        ]),
      ),
    ).resolves.toBe(0);

    expect(mocks.cleanAukletOutputByConfig).toHaveBeenCalledWith(
      process.cwd(),
      {
        output: 'lib',
        source: 'source',
        modules: true,
        build: {
          target: 'es2022',
        },
      },
    );
    expect(mocks.runTsdown).toHaveBeenCalledWith(['--minify'], {
      cwd: process.cwd(),
      env: {
        [aukletCliConfigOverridesEnv]: JSON.stringify({
          source: 'source',
          modules: true,
          build: {
            target: 'es2022',
          },
        }),
      },
    });
    expect(mocks.runBuildCss).toHaveBeenCalledWith({
      cwd: process.cwd(),
      envContext: expect.anything(),
      overrides: {},
      watch: false,
      aukletConfig: {
        output: 'lib',
        source: 'source',
        modules: true,
        build: {
          target: 'es2022',
        },
      },
    });
  });

  test('builds filtered workspace packages in resolved order', async () => {
    mocks.resolveWorkspaceScriptTargets.mockResolvedValue([
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
        packageJson: {
          scripts: {
            build: 'auk build',
          },
        },
      },
    ]);

    await expect(
      runBuild(
        parseTestBuildCommand([
          '--filter',
          '*',
          '--private',
          '--source',
          'source',
        ]),
      ),
    ).resolves.toBe(0);

    expect(mocks.resolveWorkspaceScriptTargets).toHaveBeenCalledWith(
      process.cwd(),
      ['*'],
      expect.anything(),
      {
        scope: 'build',
        emptyTargetMessage: '[build] no buildable workspace package found.',
        includeDependencies: false,
        includePrivate: true,
      },
    );
    expect(mocks.execa).toHaveBeenNthCalledWith(
      1,
      'pnpm',
      ['run', 'build', '--', '--source', 'source'],
      {
        cwd: '/repo/packages/theme',
        env: {
          AUKLET_WORKSPACE_BUILD: '1',
        },
        stdio: 'inherit',
        reject: false,
      },
    );
    expect(mocks.execa).toHaveBeenNthCalledWith(
      2,
      'pnpm',
      ['run', 'build', '--', '--source', 'source'],
      {
        cwd: '/repo/packages/ui',
        env: {
          AUKLET_WORKSPACE_BUILD: '1',
        },
        stdio: 'inherit',
        reject: false,
      },
    );
    expect(mocks.runTsdown).not.toHaveBeenCalled();
    expect(mocks.runBuildCss).not.toHaveBeenCalled();
  });

  test('uses deps as workspace target selector option', async () => {
    mocks.resolveWorkspaceScriptTargets.mockResolvedValue([
      {
        packageName: '@scope/ui',
        packageRoot: '/repo/packages/ui',
        packageJson: {
          scripts: {
            build: 'auk build',
          },
        },
      },
    ]);

    await expect(
      runBuild(
        parseTestBuildCommand([
          '--filter',
          '@scope/ui',
          '--deps',
          '--source',
          'source',
        ]),
      ),
    ).resolves.toBe(0);

    expect(mocks.resolveWorkspaceScriptTargets).toHaveBeenCalledWith(
      process.cwd(),
      ['@scope/ui'],
      expect.anything(),
      {
        scope: 'build',
        emptyTargetMessage: '[build] no buildable workspace package found.',
        includeDependencies: true,
        includePrivate: false,
      },
    );
    expect(mocks.execa).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build', '--', '--source', 'source'],
      expect.objectContaining({
        cwd: '/repo/packages/ui',
      }),
    );
  });

  test('rejects deps without workspace selectors', async () => {
    await expect(runBuild(parseTestBuildCommand(['--deps']))).rejects.toThrow(
      '--deps requires --filter or --workspace',
    );
    expect(mocks.resolveWorkspaceScriptTargets).not.toHaveBeenCalled();
    expect(mocks.runTsdown).not.toHaveBeenCalled();
  });

  test('rejects workspace build targets without build scripts', async () => {
    mocks.resolveWorkspaceScriptTargets.mockResolvedValue([
      {
        packageName: '@scope/theme',
        packageRoot: '/repo/packages/theme',
        packageJson: {},
      },
    ]);

    await expect(
      runBuild(parseTestBuildCommand(['--workspace'])),
    ).rejects.toThrow('[build] package @scope/theme has no build script.');

    expect(mocks.execa).not.toHaveBeenCalled();
    expect(mocks.runTsdown).not.toHaveBeenCalled();
    expect(mocks.runBuildCss).not.toHaveBeenCalled();
  });

  test('rejects recursive workspace builds', async () => {
    const originalValue = process.env.AUKLET_WORKSPACE_BUILD;
    process.env.AUKLET_WORKSPACE_BUILD = '1';

    try {
      await expect(
        runBuild(parseTestBuildCommand(['--workspace'])),
      ).rejects.toThrow('recursive workspace build detected');
    } finally {
      if (originalValue === undefined) {
        delete process.env.AUKLET_WORKSPACE_BUILD;
      } else {
        process.env.AUKLET_WORKSPACE_BUILD = originalValue;
      }
    }

    expect(mocks.resolveWorkspaceScriptTargets).not.toHaveBeenCalled();
    expect(mocks.execa).not.toHaveBeenCalled();
  });
});
