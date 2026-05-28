import { afterEach, describe, expect, test, vi } from 'vitest';
import { Logger } from 'briefing';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import {
  readPackageJson,
  writePackageJson,
} from '#auklet/publish/api/packageJsonApi';
import {
  commitRelease,
  createVersionTag,
  ensureGitClean,
  hasGitChanges,
} from '#auklet/publish/api/gitApi';
import { runPublishHook } from '#auklet/publish/api/publishHookApi';
import {
  hasPublishedPackageVersion,
  NpmPublishAuthenticationError,
  runPnpmPublish,
  runPnpmWhoami,
} from '#auklet/publish/api/pnpmApi';
import { formatPublishOutputs } from '#auklet/publish/runner/publishOutputFormatter';
import { PublishRunner } from '#auklet/publish/publishRunner';

const readPackage = vi.mocked(readPackageJson);
const writePackage = vi.mocked(writePackageJson);
const resolvePlan = vi.mocked(resolvePublishPlan);
const runHook = vi.mocked(runPublishHook);
const formatOutputs = vi.mocked(formatPublishOutputs);
const commit = vi.mocked(commitRelease);
const createTag = vi.mocked(createVersionTag);
const hasChanges = vi.mocked(hasGitChanges);
const hasPublishedVersion = vi.mocked(hasPublishedPackageVersion);
const publish = vi.mocked(runPnpmPublish);
const whoami = vi.mocked(runPnpmWhoami);

const stripAnsi = (value: string) => {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
};

const getConsoleMessages = (
  ...spies: Array<{
    mock: { calls: Array<Array<unknown>> };
  }>
) => {
  return spies.flatMap((spy) =>
    spy.mock.calls.map(([message]) => stripAnsi(String(message))),
  );
};

vi.mock('#auklet/publish/targetResolver', () => ({
  resolvePublishPlan: vi.fn(() => ({
    root: process.cwd(),
    version: '1.0.1',
    dryRun: false,
    config: {},
    workspaceMode: 'single',
    targets: [
      {
        packageRoot: process.cwd(),
        packageName: '@scope/ui',
        version: '1.0.0',
        publishVersion: '1.0.1',
        private: false,
        kind: 'package',
        workspaceMode: 'single',
        packageJson: {
          name: '@scope/ui',
          version: '1.0.0',
          scripts: {
            build: 'auk build',
          },
        },
      },
    ],
  })),
}));

vi.mock('#auklet/publish/api/gitApi', () => ({
  isGitRepository: vi.fn(() => true),
  ensureGitClean: vi.fn(),
  hasGitChanges: vi.fn(() => false),
  commitRelease: vi.fn(),
  createVersionTag: vi.fn(),
}));

vi.mock('#auklet/publish/runner/packageBuilder', () => ({
  validateBuildScript: vi.fn(),
  runPackageBuilds: vi.fn(),
}));

vi.mock('#auklet/publish/runner/publishOutputFormatter', () => ({
  formatPublishOutputs: vi.fn(),
}));

vi.mock('#auklet/publish/api/publishHookApi', () => ({
  runPublishHook: vi.fn(),
}));

vi.mock('#auklet/publish/api/packageJsonApi', () => ({
  readPackageJson: vi.fn(() => ({ name: '@scope/ui', version: '1.0.0' })),
  writePackageJson: vi.fn(),
}));

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  NpmPublishAuthenticationError: class NpmPublishAuthenticationError extends Error {},
  NpmPackageVersionExistsError: class NpmPackageVersionExistsError extends Error {
    constructor(packageName: string, version: string) {
      super(`[publish] package ${packageName}@${version} already exists.`);
    }
  },
  hasPublishedPackageVersion: vi.fn(() => false),
  runPnpmOwnerAdd: vi.fn(),
  runPnpmPublish: vi.fn(),
  runPnpmWhoami: vi.fn(),
}));

describe('PublishRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    runHook.mockResolvedValue(undefined);
  });

  test('skips git checks, commit checks, and tags with --allow-dirty', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: true,
    }).run();

    expect(ensureGitClean).not.toHaveBeenCalled();
    expect(hasGitChanges).not.toHaveBeenCalled();
    expect(createVersionTag).not.toHaveBeenCalled();
    expect(runPnpmPublish).toHaveBeenCalledWith(
      process.cwd(),
      expect.arrayContaining(['--no-git-checks']),
    );
    expect(getConsoleMessages(warn)).toContain(
      'publish › --allow-dirty enabled, skipping git commit and tag.',
    );
  });

  test('writes versions but skips git operations with --allow-dirty', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      version: 'patch',
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: true,
    }).run();

    expect(readPackage).toHaveBeenCalledWith(process.cwd());
    expect(writePackage).toHaveBeenCalledWith(process.cwd(), {
      name: '@scope/ui',
      version: '1.0.1',
    });
    expect(ensureGitClean).not.toHaveBeenCalled();
    expect(hasGitChanges).not.toHaveBeenCalled();
    expect(createVersionTag).not.toHaveBeenCalled();
    expect(getConsoleMessages(warn)).toContain(
      'publish › --allow-dirty enabled, skipping git commit and tag.',
    );
  });

  test('does not write versions when beforeBuild fails', async () => {
    runHook.mockImplementation(async (options) => {
      if (options.status === 'beforeBuild') {
        throw new Error('before build failed');
      }
    });

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: [],
        version: 'patch',
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('before build failed');

    expect(writePackage).not.toHaveBeenCalled();
  });

  test('runs publish hooks with explicit build and publish status names', async () => {
    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(getHookStatuses()).toEqual([
      'beforeBuild',
      'afterBuild',
      'beforePublish',
      'afterPublish',
    ]);
  });

  test('checks npm authentication before build and version writes', async () => {
    const order: Array<string> = [];
    whoami.mockImplementationOnce(async () => {
      order.push('whoami');
      return 'publisher';
    });
    writePackage.mockImplementationOnce(() => {
      order.push('write');
    });

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      version: 'patch',
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(order).toEqual(['whoami', 'write']);
    expect(whoami).toHaveBeenCalledWith(process.cwd(), {
      packageName: '@scope/ui',
      registry: undefined,
    });
  });

  test('checks npm authentication with target package registry before version writes', async () => {
    const order: Array<string> = [];
    resolvePlan.mockResolvedValueOnce({
      root: process.cwd(),
      version: '1.0.1',
      dryRun: false,
      config: {},
      workspaceMode: 'single',
      targets: [
        createTarget('@scope/ui', {
          publishConfig: {
            registry: 'https://registry.example.test',
          },
        }),
      ],
    });
    whoami.mockImplementationOnce(async () => {
      order.push('whoami');
      return 'publisher';
    });
    writePackage.mockImplementationOnce(() => {
      order.push('write');
    });

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      version: 'patch',
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(order).toEqual(['whoami', 'write']);
    expect(whoami).toHaveBeenCalledWith(process.cwd(), {
      packageName: '@scope/ui',
      registry: 'https://registry.example.test',
    });
  });

  test('does not write versions when npm authentication is missing', async () => {
    whoami.mockRejectedValueOnce(new Error('not authenticated'));

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: [],
        version: 'patch',
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('not authenticated');

    expect(writePackage).not.toHaveBeenCalled();
    expect(runPnpmPublish).not.toHaveBeenCalled();
  });

  test('does not write versions when target publish version already exists', async () => {
    const writeError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const writeResult = vi.spyOn(Logger.prototype, 'result');
    hasPublishedVersion.mockResolvedValueOnce(true);

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: [],
        version: 'patch',
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('preflight failed for @scope/ui');

    expect(writePackage).not.toHaveBeenCalled();
    expect(runPnpmPublish).not.toHaveBeenCalled();
    expect(getConsoleMessages(writeError)).toEqual(
      expect.arrayContaining([
        'publish › package version already exists: @scope/ui@1.0.1',
      ]),
    );
    expect(writeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Publish failed'),
        body: expect.arrayContaining([
          expect.arrayContaining([
            expect.stringContaining('Failed at '),
            expect.objectContaining({
              type: 'package',
              value: '@scope/ui',
            }),
            '.',
          ]),
          expect.arrayContaining([
            expect.stringContaining('Reason: '),
            expect.stringContaining('@scope/ui@1.0.1'),
          ]),
        ]),
      }),
    );
  });

  test('logs npm publish authentication guidance with the publish logger', async () => {
    const writeError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    publish.mockRejectedValueOnce(
      new NpmPublishAuthenticationError(process.cwd()),
    );

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: [],
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('publish failed for @scope/ui');

    expect(getConsoleMessages(writeError)).toEqual(
      expect.arrayContaining([
        'publish › npm publish requires additional authentication.',
        'publish › If publish 2FA is enabled, retry with `--otp <code>`.',
        'publish › For CI, use an npm automation token.',
      ]),
    );
  });

  test('runs real publish after release commit and tag without dry-run publish preflight', async () => {
    const order: Array<string> = [];

    hasChanges.mockResolvedValueOnce(true);
    publish.mockImplementation(async (_packageRoot, args) => {
      order.push(args.includes('--dry-run') ? 'preflight' : 'publish');
    });
    commit.mockImplementation(async () => {
      order.push('commit');
    });
    createTag.mockImplementation(async () => {
      order.push('tag');
    });

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      version: 'patch',
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(order).toEqual(['commit', 'tag', 'publish']);
  });

  test('prints a final success summary with version changes', async () => {
    const writeResult = vi.spyOn(Logger.prototype, 'result');
    const writeRows = vi.spyOn(Logger.prototype, 'rows');
    const writeTasks = vi.spyOn(Logger.prototype, 'tasks');

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      dryRun: false,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(writeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Publish complete'),
        status: 'success',
        details: expect.objectContaining({
          mode: expect.stringContaining('publish'),
          packages: expect.stringContaining('1'),
          published: expect.stringContaining('1'),
          version: expect.objectContaining({
            type: 'version',
            value: '1.0.1',
          }),
        }),
      }),
    );
    expect(writeTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            status: 'success',
            title: expect.arrayContaining([
              expect.objectContaining({
                type: 'package',
                value: '@scope/ui',
              }),
            ]),
          }),
        ],
      }),
    );
    expect(writeRows).not.toHaveBeenCalled();
  });

  test('reports published packages when real publish partially fails', async () => {
    const error = new Error('registry failed');
    const writeError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const writeResult = vi.spyOn(Logger.prototype, 'result');
    const writeRows = vi.spyOn(Logger.prototype, 'rows');
    const writeTasks = vi.spyOn(Logger.prototype, 'tasks');
    const writeNote = vi.spyOn(Logger.prototype, 'note');

    resolvePlan.mockResolvedValueOnce({
      root: process.cwd(),
      version: '1.0.1',
      dryRun: false,
      config: {},
      workspaceMode: 'monorepo',
      targets: [createTarget('@scope/theme'), createTarget('@scope/widgets')],
    });
    vi.mocked(runPnpmPublish)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(error);

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: ['@scope/*'],
        version: 'patch',
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('publish failed for @scope/widgets');

    expect(getConsoleMessages(writeError)).toEqual([]);
    expect(writeNote).toHaveBeenCalledWith({
      title: expect.stringContaining('Partial publish detected'),
      body: [
        expect.stringContaining(
          'Some packages were already published before the failure.',
        ),
        '',
        expect.stringContaining('published  @scope/theme@1.0.1'),
        expect.stringContaining('failed     @scope/widgets@1.0.1'),
      ],
    });
    expect(writeNote).toHaveBeenCalledWith({
      title: expect.stringContaining('Version files may have changed'),
      body: [
        [
          expect.stringContaining(
            'package.json versions may have been written.',
          ),
        ],
        [
          expect.stringContaining(
            'Auklet will not roll them back; check publish output before retrying.',
          ),
        ],
      ],
    });
    expect(writeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Publish failed'),
        status: 'error',
        body: expect.arrayContaining([
          expect.arrayContaining([
            expect.stringContaining('Failed at '),
            expect.objectContaining({
              type: 'package',
              value: '@scope/widgets',
            }),
            '.',
          ]),
          expect.arrayContaining([
            expect.stringContaining('Reason: '),
            expect.stringContaining('registry failed'),
          ]),
        ]),
        details: expect.objectContaining({
          mode: expect.stringContaining('publish'),
          packages: expect.stringContaining('2'),
          published: expect.stringContaining('1'),
          version: expect.objectContaining({
            type: 'version',
            value: '1.0.1',
          }),
        }),
      }),
    );
    expect(writeTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            status: 'success',
            title: expect.arrayContaining([
              expect.objectContaining({
                type: 'package',
                value: '@scope/theme',
              }),
            ]),
          }),
          expect.objectContaining({
            status: 'error',
            title: expect.arrayContaining([
              expect.objectContaining({
                type: 'package',
                value: '@scope/widgets',
              }),
            ]),
          }),
        ],
      }),
    );
    expect(writeRows).not.toHaveBeenCalled();
  });

  test('previews publish failure output style', async () => {
    resolvePlan.mockResolvedValueOnce({
      root: process.cwd(),
      version: '1.0.1',
      dryRun: false,
      config: {},
      workspaceMode: 'monorepo',
      targets: [createTarget('@scope/theme'), createTarget('@scope/widgets')],
    });
    vi.mocked(runPnpmPublish)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('registry failed'));

    await expect(
      new PublishRunner({
        cwd: process.cwd(),
        filters: ['@scope/*'],
        version: 'patch',
        dryRun: false,
        format: true,
        ignoreScripts: false,
        allowDirty: false,
      }).run(),
    ).rejects.toThrow('publish failed for @scope/widgets');
  });

  test('prints dry-run version changes as skipped tasks', async () => {
    const writeResult = vi.spyOn(Logger.prototype, 'result');
    const writeTasks = vi.spyOn(Logger.prototype, 'tasks');

    resolvePlan.mockResolvedValueOnce({
      root: process.cwd(),
      version: '1.0.1',
      dryRun: true,
      config: {},
      workspaceMode: 'single',
      targets: [createTarget('@scope/ui')],
    });

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      dryRun: true,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(writeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Publish dry-run complete'),
        details: expect.objectContaining({
          mode: expect.stringContaining('dry-run'),
          published: expect.stringContaining('0'),
          version: expect.objectContaining({
            type: 'version',
            value: '1.0.1',
          }),
        }),
      }),
    );
    expect(writeTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            status: 'skipped',
            title: expect.arrayContaining([
              expect.objectContaining({
                type: 'package',
                value: '@scope/ui',
              }),
              expect.objectContaining({
                type: 'version',
                value: '1.0.0',
              }),
              expect.objectContaining({
                type: 'version',
                value: '1.0.1',
              }),
            ]),
          }),
        ],
      }),
    );
  });

  test('dry-run skips release commit, tag, and real publish', async () => {
    resolvePlan.mockResolvedValueOnce({
      root: process.cwd(),
      version: '1.0.1',
      dryRun: true,
      config: {},
      workspaceMode: 'single',
      targets: [createTarget('@scope/ui')],
    });

    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      version: 'patch',
      dryRun: true,
      format: true,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(whoami).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(createTag).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      process.cwd(),
      expect.arrayContaining(['--dry-run']),
    );
  });

  test('passes the cli format switch to publish output formatting', async () => {
    await new PublishRunner({
      cwd: process.cwd(),
      filters: [],
      dryRun: false,
      format: false,
      ignoreScripts: false,
      allowDirty: false,
    }).run();

    expect(formatOutputs).toHaveBeenCalledWith(expect.any(Array), false);
  });
});

const getHookStatuses = () => {
  return runHook.mock.calls.map(([options]) => options.status);
};

const createTarget = (
  packageName: string,
  packageJson: Record<string, unknown> = {},
) => ({
  packageRoot: process.cwd(),
  packageName,
  version: '1.0.0',
  publishVersion: '1.0.1',
  private: false,
  kind: 'package' as const,
  workspaceMode: 'monorepo' as const,
  packageJson: {
    name: packageName,
    version: '1.0.0',
    scripts: {
      build: 'auk build',
    },
    ...packageJson,
  },
});
