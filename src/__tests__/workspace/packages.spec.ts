import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
  execaSync: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: mocks.execa,
  execaSync: mocks.execaSync,
}));

import {
  readPnpmWorkspacePackageInfo,
  readPnpmWorkspacePackageInfoSync,
} from '#auklet/workspace/packages';

describe('readPnpmWorkspacePackageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('parses workspace package info from pnpm json output', async () => {
    mocks.execa.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          name: '@scope/ui',
          path: '/repo/packages/ui',
          version: '1.0.0',
        },
      ]),
    });

    await expect(readPnpmWorkspacePackageInfo('/repo')).resolves.toEqual([
      {
        name: '@scope/ui',
        path: '/repo/packages/ui',
        version: '1.0.0',
      },
    ]);
    expect(mocks.execa).toHaveBeenCalledWith(
      'pnpm',
      ['list', '-r', '--depth', '-1', '--json'],
      expect.objectContaining({
        cwd: '/repo',
        reject: false,
      }),
    );
  });

  test('throws when pnpm json output cannot be parsed', async () => {
    mocks.execa.mockResolvedValue({
      failed: false,
      stdout: '{',
    });

    await expect(readPnpmWorkspacePackageInfo('/repo')).rejects.toThrow(
      '[workspace] failed to parse workspace packages.',
    );
  });

  test('throws when pnpm output is not an array', async () => {
    mocks.execa.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({ name: '@scope/ui' }),
    });

    await expect(readPnpmWorkspacePackageInfo('/repo')).rejects.toThrow(
      'Expected `pnpm list -r --depth -1 --json` to return package objects with name/path.',
    );
  });

  test('throws when a workspace package is missing name or path', async () => {
    mocks.execa.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          name: '@scope/ui',
        },
      ]),
    });

    await expect(readPnpmWorkspacePackageInfo('/repo')).rejects.toThrow(
      'Expected `pnpm list -r --depth -1 --json` to return package objects with name/path.',
    );
  });

  test('sync reader throws pnpm failures with the original output as cause', () => {
    mocks.execaSync.mockReturnValue({
      failed: true,
      stderr: 'pnpm failed',
      stdout: '',
    });

    expect(() => readPnpmWorkspacePackageInfoSync('/repo')).toThrow(
      '[workspace] failed to read workspace packages.',
    );
  });
});
