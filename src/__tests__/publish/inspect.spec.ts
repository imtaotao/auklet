import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ensurePnpm } from '#auklet/publish/api/pnpmApi';
import { runInspectPublishCli } from '#auklet/publish/inspect';
import { inspectPublishRegistry } from '#auklet/publish/inspectRegistry';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import type { PublishPlan } from '#auklet/publish/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

vi.mock('#auklet/publish/api/pnpmApi', () => ({
  ensurePnpm: vi.fn(),
}));

vi.mock('#auklet/publish/targetResolver', () => ({
  resolvePublishPlan: vi.fn(),
}));

vi.mock('#auklet/publish/inspectRegistry', () => ({
  inspectPublishRegistry: vi.fn(),
}));

const ensurePnpmExists = vi.mocked(ensurePnpm);
const inspectRegistry = vi.mocked(inspectPublishRegistry);
const resolvePlan = vi.mocked(resolvePublishPlan);

describe('runInspectPublishCli', () => {
  let project: VirtualProject;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    project = createVirtualProject('auklet-inspect-publish-');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    ensurePnpmExists.mockResolvedValue('10.0.0');
  });

  afterEach(() => {
    project.cleanup();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  test('stops before registry checks when package file checks fail', async () => {
    resolvePlan.mockResolvedValue(
      createPlan({
        packageRoot: project.root,
        packageJson: {
          name: '@scope/ui',
          version: '1.0.0',
          exports: {
            '.': './dist/missing.js',
          },
        },
      }),
    );

    await expect(runInspectPublishCli(['--dry-run'])).resolves.toBe(1);

    expect(ensurePnpmExists).toHaveBeenCalled();
    expect(inspectRegistry).not.toHaveBeenCalled();
  });

  test('runs registry checks after package file checks pass', async () => {
    project.writeFile('dist/index.js', 'export {};\n');
    resolvePlan.mockResolvedValue(
      createPlan({
        packageRoot: project.root,
        packageJson: {
          name: '@scope/ui',
          version: '1.0.0',
          exports: {
            '.': './dist/index.js',
          },
        },
      }),
    );
    inspectRegistry.mockResolvedValue([
      {
        packageName: '@scope/ui',
        registry: 'default',
        auth: 'success',
        version: 'success',
        reason: null,
      },
    ]);

    await expect(runInspectPublishCli(['--dry-run'])).resolves.toBe(0);

    expect(inspectRegistry).toHaveBeenCalledTimes(1);
  });

  test('passes npm token to registry checks', async () => {
    project.writeFile('dist/index.js', 'export {};\n');
    resolvePlan.mockResolvedValue(
      createPlan({
        packageRoot: project.root,
        packageJson: {
          name: '@scope/ui',
          version: '1.0.0',
          exports: {
            '.': './dist/index.js',
          },
        },
      }),
    );
    inspectRegistry.mockResolvedValue([
      {
        packageName: '@scope/ui',
        registry: 'default',
        auth: 'success',
        version: 'success',
        reason: null,
      },
    ]);

    await expect(
      runInspectPublishCli(['--dry-run', '--token', 'npm_secret']),
    ).resolves.toBe(0);

    expect(ensurePnpmExists).toHaveBeenCalledWith({
      env: {
        NODE_AUTH_TOKEN: 'npm_secret',
        NPM_TOKEN: 'npm_secret',
      },
    });
    expect(inspectRegistry).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        token: expect.objectContaining({
          raw: 'npm_secret',
        }),
      }),
    );
  });

  test('passes the root env context as runtime state', async () => {
    project.writeFile('dist/index.js', 'export {};\n');
    resolvePlan.mockResolvedValue(
      createPlan({
        packageRoot: project.root,
        packageJson: {
          name: '@scope/ui',
          version: '1.0.0',
          exports: {
            '.': './dist/index.js',
          },
        },
      }),
    );
    inspectRegistry.mockResolvedValue([
      {
        packageName: '@scope/ui',
        registry: 'default',
        auth: 'success',
        version: 'success',
        reason: null,
      },
    ]);

    await expect(runInspectPublishCli(['--dry-run'])).resolves.toBe(0);

    expect(resolvePlan).toHaveBeenCalledWith(
      expect.not.objectContaining({ envContext: expect.any(Object) }),
      expect.objectContaining({
        envContext: expect.any(Object),
      }),
      expect.any(Object),
    );
    expect(inspectRegistry).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtime: expect.objectContaining({
          envContext: expect.any(Object),
        }),
      }),
    );
  });
});

const createPlan = (options: {
  packageRoot: string;
  packageJson: PublishPlan['targets'][number]['packageJson'];
}): PublishPlan => {
  return {
    root: options.packageRoot,
    version: '1.0.0',
    dryRun: true,
    workspaceMode: 'single',
    config: {},
    targets: [
      {
        packageRoot: options.packageRoot,
        packageName: '@scope/ui',
        version: '1.0.0',
        publishVersion: '1.0.0',
        private: false,
        kind: 'package',
        workspaceMode: 'single',
        packageJson: options.packageJson,
      },
    ],
  };
};
