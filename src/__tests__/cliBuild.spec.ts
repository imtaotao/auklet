import { beforeEach, describe, expect, test, vi } from 'vitest';
import { aukletCliConfigOverridesEnv } from '#auklet/build/cliOverrides';

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
  const resolveWorkspaceBuildTargets = vi.fn();

  return {
    cleanAukletOutputByConfig,
    execa,
    loadAukletConfig,
    resolveWorkspaceBuildTargets,
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

vi.mock('#auklet/cli/buildWorkspace', () => ({
  resolveWorkspaceBuildTargets: mocks.resolveWorkspaceBuildTargets,
}));

vi.mock('#auklet/logger', () => ({
  createAukletLogger: () => ({
    group: async (_title: string, callback: () => Promise<unknown>) =>
      callback(),
    newline: vi.fn(),
  }),
}));

import { runBuild } from '#auklet/cli/build';

describe('runBuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses the same CLI override config for JavaScript and CSS builds', async () => {
    await expect(
      runBuild([
        '--source',
        'source',
        '--modules',
        '--build.target',
        'es2022',
        '--minify',
      ]),
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
    expect(mocks.runBuildCss).toHaveBeenCalledWith([], {
      aukletConfig: {
        output: 'lib',
        source: 'source',
        modules: true,
        build: {
          target: 'es2022',
        },
      },
      envContext: expect.anything(),
      packageRoot: process.cwd(),
    });
  });

  test('builds filtered workspace packages in resolved order', async () => {
    mocks.resolveWorkspaceBuildTargets.mockResolvedValue([
      {
        packageName: '@scope/theme',
        packageRoot: '/repo/packages/theme',
        packageJson: {},
      },
      {
        packageName: '@scope/ui',
        packageRoot: '/repo/packages/ui',
        packageJson: {},
      },
    ]);

    await expect(
      runBuild(['--filter', '*', '--source', 'source']),
    ).resolves.toBe(0);

    expect(mocks.resolveWorkspaceBuildTargets).toHaveBeenCalledWith(
      process.cwd(),
      ['*'],
      expect.anything(),
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

  test('rejects recursive workspace builds', async () => {
    const originalValue = process.env.AUKLET_WORKSPACE_BUILD;
    process.env.AUKLET_WORKSPACE_BUILD = '1';

    try {
      await expect(runBuild(['--workspace'])).rejects.toThrow(
        'recursive workspace build detected',
      );
    } finally {
      if (originalValue === undefined) {
        delete process.env.AUKLET_WORKSPACE_BUILD;
      } else {
        process.env.AUKLET_WORKSPACE_BUILD = originalValue;
      }
    }

    expect(mocks.resolveWorkspaceBuildTargets).not.toHaveBeenCalled();
    expect(mocks.execa).not.toHaveBeenCalled();
  });
});
