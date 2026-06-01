import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  hasPublishedPackageVersion,
  runPnpmWhoami,
} from '#auklet/publish/api/pnpmApi';
import { inspectPublishRegistry } from '#auklet/publish/inspectRegistry';
import type { PublishPlan, PublishTarget } from '#auklet/publish/types';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  hasPublishedPackageVersion: vi.fn(),
  runPnpmWhoami: vi.fn(),
}));

const checkPublishedVersion = vi.mocked(hasPublishedPackageVersion);
const checkWhoami = vi.mocked(runPnpmWhoami);

describe('inspectPublishRegistry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('checks auth once per package root and registry, then checks target versions', async () => {
    checkWhoami.mockResolvedValue('alice');
    checkPublishedVersion.mockResolvedValue(false);

    const checks = await inspectPublishRegistry({
      targets: [
        createTarget('@scope/theme', '/repo/packages/theme'),
        createTarget('@scope/ui', '/repo/packages/ui'),
      ],
    } as PublishPlan);

    expect(checkWhoami).toHaveBeenCalledTimes(2);
    expect(checkPublishedVersion).toHaveBeenCalledWith(
      '/repo/packages/theme',
      '@scope/theme',
      '1.0.1',
      {
        registry: 'http://127.0.0.1:4873',
        timeout: 5000,
      },
    );
    expect(checks).toEqual([
      {
        packageName: '@scope/theme',
        registry: 'http://127.0.0.1:4873',
        auth: 'success',
        version: 'success',
        reason: null,
      },
      {
        packageName: '@scope/ui',
        registry: 'http://127.0.0.1:4873',
        auth: 'success',
        version: 'success',
        reason: null,
      },
    ]);
  });

  test('reports retry attempts and version existence failures', async () => {
    const onRetry = vi.fn();
    checkWhoami
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce('alice');
    checkPublishedVersion.mockResolvedValue(true);

    const checks = await inspectPublishRegistry(
      {
        targets: [createTarget('@scope/ui', '/repo/packages/ui')],
      } as PublishPlan,
      { onRetry },
    );

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: '@scope/ui',
        registry: 'http://127.0.0.1:4873',
        check: 'auth',
        attempt: 1,
        maxAttempts: 2,
      }),
    );
    expect(checks).toEqual([
      {
        packageName: '@scope/ui',
        registry: 'http://127.0.0.1:4873',
        auth: 'success',
        version: 'error',
        reason: 'version already exists: @scope/ui@1.0.1',
      },
    ]);
  });
});

const createTarget = (
  packageName: string,
  packageRoot: string,
): PublishTarget => {
  return {
    packageRoot,
    packageName,
    version: '1.0.0',
    publishVersion: '1.0.1',
    private: false,
    kind: 'package',
    workspaceMode: 'monorepo',
    packageJson: {
      name: packageName,
      version: '1.0.0',
      publishConfig: {
        registry: 'http://127.0.0.1:4873',
      },
    },
  };
};
