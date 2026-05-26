import { afterEach, describe, expect, test, vi } from 'vitest';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { runPublishCli } from '#auklet/publish/cli';
import { PublishRunner } from '#auklet/publish/publishRunner';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  ensurePnpm: vi.fn(),
}));

vi.mock('#auklet/publish/ownerRunner', () => ({
  OwnerRunner: vi.fn(),
}));

vi.mock('#auklet/publish/publishRunner', () => ({
  PublishRunner: vi.fn(function PublishRunner() {
    return { run: vi.fn() };
  }),
}));

const ensurePnpmExists = vi.mocked(ensurePnpm);
const createPublishRunner = vi.mocked(PublishRunner);

describe('runPublishCli', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('ignores a leading args separator from package scripts', async () => {
    await runPublishCli([
      '--filter',
      '@scope/*',
      '--allow-dirty',
      '--',
      '--version',
      'patch',
    ]);

    expect(ensurePnpmExists).toHaveBeenCalled();
    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 'patch',
        allowDirty: true,
        format: true,
        filters: ['@scope/*'],
      }),
    );
  });

  test('passes --no-format as the publish output format switch', async () => {
    await runPublishCli(['--no-format']);

    expect(createPublishRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        format: false,
      }),
    );
  });

  test('rejects unknown --no-prefixed flags', async () => {
    await expect(runPublishCli(['--no-build'])).rejects.toThrow(
      'unknown option: --no-build',
    );
  });
});
