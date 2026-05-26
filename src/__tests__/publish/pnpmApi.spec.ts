import { afterEach, describe, expect, test, vi } from 'vitest';
import { execa } from 'execa';
import {
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
