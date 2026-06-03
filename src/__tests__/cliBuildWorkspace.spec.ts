import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AukletEnvContext } from '#auklet/env';
import { readPnpmWorkspacePackageInfo } from '#auklet/workspace/packages';
import { resolveWorkspaceBuildTargets } from '#auklet/cli/buildWorkspace';
import {
  createVirtualProject,
  type VirtualProject,
} from './fixtures/virtualProject';

vi.mock('#auklet/workspace/packages', () => ({
  readPnpmWorkspacePackageInfo: vi.fn(),
}));

const readWorkspacePackages = vi.mocked(readPnpmWorkspacePackageInfo);

describe('resolveWorkspaceBuildTargets', () => {
  let project: VirtualProject;

  beforeEach(() => {
    readWorkspacePackages.mockReset();
    project = createVirtualProject('auklet-workspace-build-');
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

  test('matches all non-private workspace packages and sorts dependencies first', async () => {
    writeWorkspacePackage('theme');
    writeWorkspacePackage('ui', {
      dependencies: {
        '@scope/theme': 'workspace:^',
      },
    });
    readWorkspacePackages.mockResolvedValue([
      workspacePackage('@scope/root', project.root, true),
      workspacePackage('@scope/ui', project.resolve('packages/ui')),
      workspacePackage('@scope/theme', project.resolve('packages/theme')),
    ]);

    await expect(
      resolveWorkspaceBuildTargets(
        project.root,
        ['*'],
        new AukletEnvContext(project.root),
      ),
    ).resolves.toMatchObject([
      {
        packageName: '@scope/theme',
      },
      {
        packageName: '@scope/ui',
      },
    ]);
  });

  test('requires a workspace root for filtered builds', async () => {
    const singleProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'auklet-single-build-'),
    );
    try {
      await expect(
        resolveWorkspaceBuildTargets(
          singleProjectRoot,
          ['*'],
          new AukletEnvContext(singleProjectRoot),
        ),
      ).rejects.toThrow('--filter requires a pnpm workspace root');
    } finally {
      fs.rmSync(singleProjectRoot, { recursive: true, force: true });
    }
  });

  const writeWorkspacePackage = (
    name: string,
    fields: Record<string, unknown> = {},
  ) => {
    project.writeJson(`packages/${name}/package.json`, {
      name: `@scope/${name}`,
      version: '1.0.0',
      ...fields,
    });
  };
});

const workspacePackage = (
  name: string,
  packagePath: string,
  privatePackage = false,
) => {
  return {
    name,
    path: packagePath,
    private: privatePackage,
  };
};
