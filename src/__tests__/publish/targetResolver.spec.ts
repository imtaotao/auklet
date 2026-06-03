import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readPnpmWorkspacePackages } from '#auklet/publish/api/pnpmApi';
import { AukletEnvContext } from '#auklet/env';
import {
  resolveOwnerPackageNames,
  resolvePublishPlan,
} from '#auklet/publish/targetResolver';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  readPnpmWorkspacePackages: vi.fn(),
}));

const readWorkspacePackages = vi.mocked(readPnpmWorkspacePackages);

const stripAnsi = (value: string) => {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
};

const getConsoleMessages = (spy: {
  mock: { calls: Array<Array<unknown>> };
}) => {
  return spy.mock.calls.map(([message]) => stripAnsi(String(message)));
};

type ResolvePublishPlanOptions = Parameters<typeof resolvePublishPlan>[0];

const resolveTestPublishPlan = (options: ResolvePublishPlanOptions) => {
  return resolvePublishPlan(options, {
    envContext: new AukletEnvContext(options.cwd),
  });
};

describe('resolvePublishPlan', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-publish-');
    project.writeFile('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    project.writePackageJson({
      name: '@scope/root',
      version: '1.0.0',
      private: true,
    });
  });

  afterEach(() => {
    project.cleanup();
    vi.clearAllMocks();
  });

  test('requires shared monorepo versions when no version is requested', async () => {
    writeWorkspacePackage('ui', '0.9.0');
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '0.9.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).rejects.toThrow(
      'package @scope/ui version 0.9.0 does not match shared version 1.0.0',
    );
  });

  test('targets the current package when publish runs without filters', async () => {
    const packageRoot = project.resolve('packages/ui');
    writeWorkspacePackage('ui', '1.0.0');

    await expect(
      resolveTestPublishPlan({
        cwd: packageRoot,
        filters: [],
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      root: packageRoot,
      workspaceMode: 'single',
      targets: [
        {
          packageName: '@scope/ui',
          packageRoot,
          publishVersion: '1.0.0',
        },
      ],
    });
  });

  test('rejects publishing the private monorepo root without filters', async () => {
    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: [],
        dryRun: false,
      }),
    ).rejects.toThrow(
      'current directory is a private monorepo root. Use --filter to select workspace packages.',
    );
  });

  test('requires a workspace root for filtered publish', async () => {
    const singleProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'auklet-publish-single-'),
    );
    fs.writeFileSync(
      path.join(singleProjectRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@scope/ui',
          version: '1.0.0',
        },
        null,
        2,
      ),
    );

    try {
      await expect(
        resolveTestPublishPlan({
          cwd: singleProjectRoot,
          filters: ['*'],
          dryRun: false,
        }),
      ).rejects.toThrow('--filter requires a pnpm workspace root');
    } finally {
      fs.rmSync(singleProjectRoot, { recursive: true, force: true });
    }
  });

  test('allows --version to normalize old monorepo package versions', async () => {
    writeWorkspacePackage('ui', '0.9.0');
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '0.9.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        version: 'patch',
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      version: '1.0.1',
      targets: [
        {
          packageName: '@scope/ui',
          version: '0.9.0',
          publishVersion: '1.0.1',
        },
      ],
    });
  });

  test('increments monorepo publish version from the highest selected package version', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.1');
    readWorkspacePackages.mockResolvedValue([
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.1'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        version: 'patch',
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      version: '1.0.2',
      targets: [
        {
          packageName: '@scope/theme',
          publishVersion: '1.0.2',
        },
        {
          packageName: '@scope/ui',
          version: '1.0.1',
          publishVersion: '1.0.2',
        },
      ],
    });
  });

  test('silently skips private packages matched by scope filters', async () => {
    writeWorkspacePackage('ui', '1.0.0');
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/root', project.root, '1.0.0', true),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
    ]);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      targets: [
        {
          packageName: '@scope/ui',
        },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('matches all workspace packages with wildcard filters', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.0', {
      dependencies: {
        '@scope/theme': 'workspace:*',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/root', project.root, '1.0.0', true),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
    ]);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['*'],
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      targets: [
        {
          packageName: '@scope/theme',
        },
        {
          packageName: '@scope/ui',
        },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test('warns when a private package is matched exactly', async () => {
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/root', project.root, '1.0.0', true),
    ]);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/root'],
        dryRun: false,
      }),
    ).rejects.toThrow('no publishable package found');
    expect(getConsoleMessages(warn)).toContain(
      'publish › package @scope/root is private, skipping.',
    );
  });

  test('requires workspace:* for dependencies between selected workspace packages', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.0', {
      dependencies: {
        '@scope/theme': '^1.0.0',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).rejects.toThrow(
      'package @scope/ui dependencies @scope/theme must use workspace:* before publishing',
    );
  });

  test('requires workspace:* for optional dependencies between selected workspace packages', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.0', {
      optionalDependencies: {
        '@scope/theme': 'workspace:^',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).rejects.toThrow(
      'package @scope/ui optionalDependencies @scope/theme must use workspace:* before publishing',
    );
  });

  test('requires workspace:* for peer dependencies between selected workspace packages', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.0', {
      peerDependencies: {
        '@scope/theme': '^1.0.0',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).rejects.toThrow(
      'package @scope/ui peerDependencies @scope/theme must use workspace:* before publishing',
    );
  });

  test('allows workspace:* peer dependencies between selected workspace packages', async () => {
    writeWorkspacePackage('theme', '1.0.0');
    writeWorkspacePackage('ui', '1.0.0', {
      peerDependencies: {
        '@scope/theme': 'workspace:*',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage(
        '@scope/theme',
        project.resolve('packages/theme'),
        '1.0.0',
      ),
      workspacePackage('@scope/ui', project.resolve('packages/ui'), '1.0.0'),
    ]);

    await expect(
      resolveTestPublishPlan({
        cwd: project.root,
        filters: ['@scope/*'],
        dryRun: false,
      }),
    ).resolves.toMatchObject({
      targets: [
        {
          packageName: '@scope/theme',
        },
        {
          packageName: '@scope/ui',
        },
      ],
    });
  });

  function writeWorkspacePackage(
    name: string,
    version: string,
    fields: Record<string, unknown> = {},
  ) {
    project.writeJson(`packages/${name}/package.json`, {
      name: `@scope/${name}`,
      version,
      scripts: {
        build: 'auk build',
      },
      ...fields,
    });
  }
});

describe('resolveOwnerPackageNames', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-owner-');
    project.writePackageJson({
      name: '@scope/ui',
      version: '1.0.0',
    });
  });

  afterEach(() => {
    project.cleanup();
    vi.clearAllMocks();
  });

  test('targets the current package when owner add runs without package selectors', async () => {
    await expect(
      resolveOwnerPackageNames({
        cwd: project.root,
        filters: [],
        packages: [],
      }),
    ).resolves.toEqual(['@scope/ui']);
  });

  test('rejects owner add on a private current package without package selectors', async () => {
    project.writePackageJson({
      name: '@scope/private',
      version: '1.0.0',
      private: true,
    });

    await expect(
      resolveOwnerPackageNames({
        cwd: project.root,
        filters: [],
        packages: [],
      }),
    ).rejects.toThrow('current package is private');
  });

  test('rejects owner add when filter and package selectors are combined', async () => {
    await expect(
      resolveOwnerPackageNames({
        cwd: project.root,
        filters: ['@scope/*'],
        packages: ['@scope/ui'],
      }),
    ).rejects.toThrow(
      'owner command cannot use --filter and --package together',
    );
  });
});

function workspacePackage(
  name: string,
  packagePath: string,
  version: string,
  privatePackage = false,
) {
  return {
    name,
    path: packagePath,
    version,
    private: privatePackage,
  };
}
