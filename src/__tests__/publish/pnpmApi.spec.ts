import { afterEach, describe, expect, test, vi } from 'vitest';
import { execa } from 'execa';
import {
  hasPublishedPackageVersion,
  NpmPublishAuthenticationError,
  runPnpmPublish,
} from '#auklet/publish/api/pnpmApi';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const run = vi.mocked(execa);

describe('runPnpmPublish', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('adds guidance when npm asks for additional authentication', async () => {
    run.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr:
        'Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/token',
    } as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runPnpmPublish(process.cwd(), [])).rejects.toThrow(
      NpmPublishAuthenticationError,
    );
  });
});

describe('hasPublishedPackageVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns true when the package version exists', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '1.0.1',
      stderr: '',
    } as never);

    await expect(
      hasPublishedPackageVersion(process.cwd(), '@scope/ui', '1.0.1', {
        registry: 'https://registry.example.test',
      }),
    ).resolves.toBe(true);

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      [
        'view',
        '@scope/ui@1.0.1',
        'version',
        '--registry',
        'https://registry.example.test',
      ],
      expect.objectContaining({
        cwd: process.cwd(),
        reject: false,
      }),
    );
  });

  test('returns false when the package version is not found', async () => {
    run.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'npm ERR! code E404',
    } as never);

    await expect(
      hasPublishedPackageVersion(process.cwd(), '@scope/ui', '1.0.1'),
    ).resolves.toBe(false);
  });
});
