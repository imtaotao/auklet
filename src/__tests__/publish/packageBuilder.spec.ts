import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runPnpmBuild } from '#auklet/publish/api/pnpmApi';
import {
  runPackageBuilds,
  validateBuildScript,
} from '#auklet/publish/runner/packageBuilder';
import { AukletEnvContext } from '#auklet/env';
import type { PublishTarget } from '#auklet/publish/types';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  runPnpmBuild: vi.fn(),
}));

const buildPackage = vi.mocked(runPnpmBuild);

describe('publish package builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requires every publish target to define a build script', () => {
    expect(() =>
      validateBuildScript([
        createTarget('@scope/ui', {
          scripts: {},
        }),
      ]),
    ).toThrow(
      'package @scope/ui must define package.json#scripts.build before publishing',
    );
  });

  test('runs package builds in target order and logs each package', async () => {
    const logger = {
      package: (name: string) => ({ type: 'package', value: name }),
      step: vi.fn(),
    };

    await runPackageBuilds(
      [createTarget('@scope/theme'), createTarget('@scope/ui')],
      logger as never,
      {},
      {
        envContext: new AukletEnvContext('/repo', '/repo'),
      },
    );

    expect(buildPackage).toHaveBeenNthCalledWith(1, '/repo/theme');
    expect(buildPackage).toHaveBeenNthCalledWith(2, '/repo/ui');
    expect(logger.step).toHaveBeenNthCalledWith(1, 'build ', {
      type: 'package',
      value: '@scope/theme',
    });
    expect(logger.step).toHaveBeenNthCalledWith(2, 'build ', {
      type: 'package',
      value: '@scope/ui',
    });
  });
});

const createTarget = (
  packageName: string,
  packageJson: PublishTarget['packageJson'] = {
    scripts: {
      build: 'auk build',
    },
  },
) => {
  return {
    packageRoot: `/repo/${packageName.split('/').at(-1)}`,
    packageName,
    version: '1.0.0',
    publishVersion: '1.0.1',
    private: false,
    kind: 'package',
    workspaceMode: 'monorepo',
    packageJson,
  } satisfies PublishTarget;
};
