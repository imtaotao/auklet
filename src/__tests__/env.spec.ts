import { afterEach, describe, expect, test } from 'vitest';
import { AukletEnvContext } from '#auklet/env';
import {
  createVirtualProject,
  type VirtualProject,
} from '#auklet/__tests__/fixtures/virtualProject';

describe('auklet env files', () => {
  let project: VirtualProject | null = null;

  afterEach(() => {
    project?.cleanup();
    project = null;
  });

  test('loads root env before package env and local env last', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    currentProject.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n',
    );
    currentProject.writeFile(
      '.env',
      ['TOKEN=root-token', 'ROOT_ONLY=root', 'ROOT_LOCAL=root-env'].join('\n'),
    );
    currentProject.writeFile(
      '.env.local',
      ['TOKEN=root-local-token', 'ROOT_LOCAL=root-local'].join('\n'),
    );
    currentProject.writeFile(
      'packages/ui/.env',
      [
        'TOKEN=package-token',
        'PACKAGE_ONLY=package',
        'PACKAGE_LOCAL=package-env',
      ].join('\n'),
    );
    currentProject.writeFile(
      'packages/ui/.env.local',
      ['TOKEN=package-local-token', 'PACKAGE_LOCAL=package-local'].join('\n'),
    );

    expect(
      new AukletEnvContext(
        currentProject.resolve('packages/ui'),
        currentProject.root,
      ).values,
    ).toEqual({
      TOKEN: 'package-local-token',
      ROOT_ONLY: 'root',
      ROOT_LOCAL: 'root-local',
      PACKAGE_ONLY: 'package',
      PACKAGE_LOCAL: 'package-local',
    });
  });

  test('loads package env once when package root is workspace root', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    currentProject.writeFile('.env', 'TOKEN=root-token\n');

    expect(
      new AukletEnvContext(currentProject.root, currentProject.root).values,
    ).toEqual({
      TOKEN: 'root-token',
    });
  });

  test('keeps process env before package and root env', () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    const envName = 'AUKLET_TEST_ENV_PRIORITY';
    const originalValue = process.env[envName];
    currentProject.writeFile(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n',
    );
    currentProject.writeFile('.env', `${envName}=root-token\n`);
    currentProject.writeFile('packages/ui/.env', `${envName}=package-token\n`);

    try {
      process.env[envName] = 'shell-token';
      const envContext = new AukletEnvContext(
        currentProject.resolve('packages/ui'),
        currentProject.root,
      );

      expect(envContext.values).not.toHaveProperty(envName);
      expect(envContext.resolveValue(`env:${envName}`, { label: 'test' })).toBe(
        'shell-token',
      );
    } finally {
      if (originalValue === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = originalValue;
      }
    }
  });

  test('temporarily injects env file values while running a task', async () => {
    const currentProject = createVirtualProject();
    project = currentProject;
    const envName = 'AUKLET_TEST_CONTEXT_VALUE';
    const originalValue = process.env[envName];
    currentProject.writeFile('.env', `${envName}=context-token\n`);

    try {
      delete process.env[envName];
      const envContext = new AukletEnvContext(currentProject.root);

      await envContext.run(async () => {
        expect(process.env[envName]).toBe('context-token');
      });

      expect(process.env[envName]).toBeUndefined();
    } finally {
      if (originalValue === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = originalValue;
      }
    }
  });
});
