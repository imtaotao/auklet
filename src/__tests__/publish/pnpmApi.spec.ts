import { afterEach, describe, expect, test, vi } from 'vitest';
import { execa } from 'execa';
import {
  ensurePnpm,
  hasPublishedPackageVersion,
  NpmPublishAuthenticationError,
  runPnpmBuild,
  runPnpmPublish,
  runPnpmWhoami,
  withPnpmTimeout,
} from '#auklet/publish/api/pnpmApi';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const run = vi.mocked(execa);

describe('ensurePnpm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('passes npm token to pnpm version checks', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '10.0.0',
      stderr: '',
    } as never);

    await ensurePnpm({ token: 'npm_secret' });

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['--version'],
      expect.objectContaining({
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
      }),
    );
  });
});

describe('runPnpmPublish', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('adds guidance when npm asks for additional authentication', async () => {
    run.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr:
        'Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/token',
    } as never);
    const writeStderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(runPnpmPublish(process.cwd(), ['--dry-run'])).rejects.toThrow(
      NpmPublishAuthenticationError,
    );
    expect(writeStderr).toHaveBeenCalledWith(
      'Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/token\n',
    );
  });

  test('inherits stdio for real publish so npm authentication can stay interactive', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    } as never);

    await runPnpmPublish(process.cwd(), ['--no-git-checks']);

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['publish', '--no-git-checks'],
      expect.objectContaining({
        cwd: process.cwd(),
        reject: false,
        stdio: 'inherit',
      }),
    );
  });

  test('passes npm token through the child process environment', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    } as never);

    await runPnpmPublish(process.cwd(), ['--no-git-checks'], {
      token: 'npm_secret',
    });

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['publish', '--no-git-checks'],
      expect.objectContaining({
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
      }),
    );
  });
});

describe('runPnpmBuild', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('passes npm token to package build subprocesses', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    } as never);

    await runPnpmBuild('/repo/packages/ui', { token: 'npm_secret' });

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['run', 'build'],
      expect.objectContaining({
        cwd: '/repo/packages/ui',
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
      }),
    );
  });
});

describe('hasPublishedPackageVersion', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  test('passes npm token to version existence checks', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '1.0.1',
      stderr: '',
    } as never);

    await hasPublishedPackageVersion(
      '/repo/packages/ui',
      '@scope/ui',
      '1.0.1',
      {
        token: 'npm_secret',
      },
    );

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['view', '@scope/ui@1.0.1', 'version'],
      expect.objectContaining({
        cwd: '/repo/packages/ui',
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
      }),
    );
  });
});

describe('withPnpmTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('kills the pnpm subprocess and returns a timeout result', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const subprocess = Object.assign(new Promise(() => {}), {
      kill,
    }) as unknown as ReturnType<typeof execa>;

    const resultPromise = withPnpmTimeout(subprocess, 50);
    await vi.advanceTimersByTimeAsync(50);
    const result = await resultPromise;

    expect(kill).toHaveBeenCalledWith('SIGKILL', expect.any(Error));
    expect(result).toMatchObject({
      failed: true,
      timedOut: true,
      exitCode: undefined,
      stdout: '',
      stderr: 'pnpm command timed out after 50ms.',
    });
  });

  test('surfaces timeout details in whoami errors', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    run.mockReturnValueOnce(
      Object.assign(new Promise(() => {}), {
        kill,
      }) as unknown as never,
    );

    const whoami = runPnpmWhoami('/repo/packages/ui', {
      packageName: '@scope/ui',
      registry: 'https://registry.example.test',
      timeout: 50,
    });
    const expectation = expect(whoami).rejects.toThrow(
      'Reason: pnpm command timed out after 50ms.',
    );

    await vi.advanceTimersByTimeAsync(50);
    await expectation;
    expect(kill).toHaveBeenCalledWith('SIGKILL', expect.any(Error));
    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['whoami', '--registry', 'https://registry.example.test'],
      expect.objectContaining({
        cwd: '/repo/packages/ui',
        reject: false,
        timeout: undefined,
      }),
    );
  });

  test('passes npm token to whoami checks', async () => {
    run.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'publisher',
      stderr: '',
    } as never);

    await runPnpmWhoami('/repo/packages/ui', {
      packageName: '@scope/ui',
      token: 'npm_secret',
    });

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['whoami'],
      expect.objectContaining({
        cwd: '/repo/packages/ui',
        env: {
          NODE_AUTH_TOKEN: 'npm_secret',
          NPM_TOKEN: 'npm_secret',
        },
      }),
    );
  });
});
