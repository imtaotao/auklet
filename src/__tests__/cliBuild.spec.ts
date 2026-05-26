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
  const runBuildCss = vi.fn().mockResolvedValue(0);
  const runTsdown = vi.fn().mockResolvedValue(0);

  return {
    cleanAukletOutputByConfig,
    loadAukletConfig,
    runBuildCss,
    runTsdown,
  };
});

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
    });
  });
});
