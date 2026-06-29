import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  inspectPackageFiles,
  runInspectPackCli,
} from '#auklet/publish/inspectPack';
import { resolvePublishPlan } from '#auklet/publish/targetResolver';
import type { PublishPlan, PublishTarget } from '#auklet/publish/types';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

vi.mock('#auklet/publish/targetResolver', () => ({
  resolvePublishPlan: vi.fn(),
}));

const resolvePlan = vi.mocked(resolvePublishPlan);

describe('inspectPackageFiles', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-inspect-pack-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('checks package entry fields, exports, bin, css entries, and files', () => {
    project.writeFiles({
      'dist/index.js': 'export {};\n',
      'dist/index.d.ts': 'export {};\n',
      'dist/index.css': '.root {}\n',
      'bin/entry.mjs': '#!/usr/bin/env node\n',
    });

    const checks = inspectPackageFiles([
      createTarget(project, {
        main: './dist/index.js',
        types: './dist/index.d.ts',
        style: './dist/index.css',
        bin: {
          demo: './bin/entry.mjs',
        },
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
          './missing': './dist/missing.js',
          './components/*': './dist/components/*.js',
        },
        files: ['dist', '!dist/__tests__'],
      }),
    ]);

    expect(
      checks.map((check) => ({
        field: check.field,
        file: check.file,
        status: check.status,
      })),
    ).toEqual([
      { field: 'main', file: './dist/index.js', status: 'exists' },
      { field: 'types', file: './dist/index.d.ts', status: 'exists' },
      { field: 'style', file: './dist/index.css', status: 'exists' },
      { field: 'bin.demo', file: './bin/entry.mjs', status: 'exists' },
      {
        field: 'exports["."].types',
        file: './dist/index.d.ts',
        status: 'exists',
      },
      {
        field: 'exports["."].default',
        file: './dist/index.js',
        status: 'exists',
      },
      {
        field: 'exports["./missing"]',
        file: './dist/missing.js',
        status: 'missing',
      },
      {
        field: 'exports["./components/*"]',
        file: './dist/components/*.js',
        status: 'pattern',
      },
      { field: 'files[0]', file: 'dist', status: 'exists' },
      { field: 'files[1]', file: '!dist/__tests__', status: 'skipped' },
    ]);
  });
});

describe('runInspectPackCli', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-inspect-pack-cli-');
  });

  afterEach(() => {
    project.cleanup();
    vi.clearAllMocks();
  });

  test('passes --workspace as a wildcard filter to publish plan selection', async () => {
    resolvePlan.mockResolvedValue(createPlan([createTarget(project, {})]));

    await expect(runInspectPackCli(['--workspace'])).resolves.toBe(0);

    expect(resolvePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: ['*'],
        dryRun: true,
      }),
      expect.objectContaining({
        envContext: expect.any(Object),
      }),
      expect.any(Object),
    );
  });

  test('rejects workspace values', async () => {
    await expect(runInspectPackCli(['--workspace=true'])).rejects.toThrow(
      '--workspace does not accept a value.',
    );
  });
});

const createTarget = (
  project: VirtualProject,
  packageJson: PublishTarget['packageJson'],
): PublishTarget => {
  return {
    packageRoot: project.root,
    packageName: '@scope/ui',
    version: '1.0.0',
    publishVersion: '1.0.0',
    private: false,
    kind: 'package',
    workspaceMode: 'single',
    packageJson,
  };
};

const createPlan = (targets: Array<PublishTarget>) => {
  const [firstTarget] = targets;
  const root = firstTarget ? firstTarget.packageRoot : process.cwd();

  return {
    root,
    version: '1.0.0',
    dryRun: true,
    targets,
    config: {},
    workspaceMode: 'single',
  } satisfies PublishPlan;
};
