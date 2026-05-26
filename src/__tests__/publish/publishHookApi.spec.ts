import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: mocks.execa,
}));

import { runPublishHook } from '#auklet/publish/api/publishHookApi';
import type { PublishPlan, PublishTarget } from '#auklet/publish/types';

describe('runPublishHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execa.mockResolvedValue({
      exitCode: 0,
    });
  });

  test('runs configured hook commands with publish context env', async () => {
    await runPublishHook({
      status: 'afterPublish',
      plan: createPlan({
        afterPublish: ['echo done', 'notify'],
      }),
      result: 'failure',
      failedTarget: createTarget('@scope/ui'),
      error: new Error('registry failed'),
    });

    expect(mocks.execa).toHaveBeenCalledTimes(2);
    expect(mocks.execa).toHaveBeenNthCalledWith(
      1,
      'echo done',
      expect.objectContaining({
        cwd: '/repo',
        shell: true,
        stdio: 'inherit',
        reject: false,
        env: expect.objectContaining({
          AUKLET_PUBLISH_DRY_RUN: 'false',
          AUKLET_PUBLISH_ERROR: 'registry failed',
          AUKLET_PUBLISH_FAILED_PACKAGE: '@scope/ui',
          AUKLET_PUBLISH_PACKAGES: '@scope/theme,@scope/ui',
          AUKLET_PUBLISH_RESULT: 'failure',
          AUKLET_PUBLISH_ROOT: '/repo',
          AUKLET_PUBLISH_STATUS: 'afterPublish',
          AUKLET_PUBLISH_VERSION: '1.0.1',
        }),
      }),
    );
    expect(mocks.execa).toHaveBeenNthCalledWith(
      2,
      'notify',
      expect.any(Object),
    );
  });

  test('skips missing hooks', async () => {
    await runPublishHook({
      status: 'beforeBuild',
      plan: createPlan({}),
    });

    expect(mocks.execa).not.toHaveBeenCalled();
  });

  test('throws when a hook command fails', async () => {
    mocks.execa.mockResolvedValue({
      exitCode: 1,
    });

    await expect(
      runPublishHook({
        status: 'beforePublish',
        plan: createPlan({
          beforePublish: 'check-registry',
        }),
      }),
    ).rejects.toThrow(
      '[auklet:publish] publish beforePublish hook failed: check-registry',
    );
  });
});

const createPlan = (config: PublishPlan['config']) => {
  return {
    root: '/repo',
    version: '1.0.1',
    dryRun: false,
    config,
    workspaceMode: 'monorepo',
    targets: [createTarget('@scope/theme'), createTarget('@scope/ui')],
  } satisfies PublishPlan;
};

const createTarget = (packageName: string) => {
  return {
    packageRoot: `/repo/packages/${packageName.split('/').at(-1)}`,
    packageName,
    version: '1.0.0',
    publishVersion: '1.0.1',
    private: false,
    kind: 'package',
    workspaceMode: 'monorepo',
    packageJson: {
      name: packageName,
      version: '1.0.0',
    },
  } satisfies PublishTarget;
};
