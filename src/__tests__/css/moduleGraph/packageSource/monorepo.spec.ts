import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { MonorepoPackageSource } from '#auklet/css/vite/moduleGraph/packageSource/monorepo';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../../fixtures/virtualProject';

describe('MonorepoPackageSource', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-monorepo-source-');
  });

  afterEach(() => {
    project.cleanup();
  });

  const createSource = () => {
    return new MonorepoPackageSource({
      root: project.root,
      styleExtensions: ['.css'],
    });
  };

  test('discovers named packages from pnpm workspace package list', () => {
    const source = new MonorepoPackageSource({
      root: project.root,
      styleExtensions: ['.css'],
      readWorkspacePackages: () => [
        {
          name: '@scope/root',
          path: project.root,
        },
        {
          name: '@scope/app',
          path: project.resolve('apps/app'),
        },
        {
          name: '@scope/ui',
          path: project.resolve('components/ui'),
        },
      ],
    });

    expect(source.getPackages()).toEqual([
      {
        packageName: '@scope/app',
        packageRoot: path.join(project.root, 'apps/app'),
      },
      {
        packageName: '@scope/ui',
        packageRoot: path.join(project.root, 'components/ui'),
      },
    ]);
    expect(source.isKnownPackageName('@scope/root')).toBe(false);
    expect(source.isKnownPackageName('@scope/ui')).toBe(true);
    expect(source.isSourceGraphFile(project.resolve('src/internal.tsx'))).toBe(
      false,
    );
    expect(
      source.isSourceGraphFile(project.resolve('apps/app/src/App.tsx')),
    ).toBe(true);
    expect(source.isKnownPackageName('@scope/missing')).toBe(false);
  });

  test('returns watch roots for workspace packages', async () => {
    const source = new MonorepoPackageSource({
      root: project.root,
      styleExtensions: ['.css'],
      readWorkspacePackages: () => [
        {
          name: '@scope/app',
          path: project.resolve('apps/app'),
        },
        {
          name: '@scope/ui',
          path: project.resolve('components/ui'),
        },
      ],
    });

    expect(await source.getWatchRoots()).toEqual([
      path.join(project.root, 'apps/app/src'),
      path.join(project.root, 'apps/app/auklet.config.js'),
      path.join(project.root, 'apps/app/auklet.config.mjs'),
      path.join(project.root, 'components/ui/src'),
      path.join(project.root, 'components/ui/auklet.config.js'),
      path.join(project.root, 'components/ui/auklet.config.mjs'),
    ]);
  });

  test('returns empty packages when the workspace package list is unavailable', async () => {
    const source = createSource();

    expect(source.getPackages()).toEqual([]);
    expect(source.getPackageNames()).toEqual([]);
    await expect(source.getWatchRoots()).resolves.toEqual([]);
  });

  test('throws workspace read errors in monorepo workspace mode', () => {
    project.writeFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');

    const source = new MonorepoPackageSource({
      root: project.root,
      styleExtensions: ['.css'],
      readWorkspacePackages: () => {
        throw new Error('workspace list failed');
      },
    });

    expect(() => source.getPackages()).toThrow(
      '[css] failed to read pnpm workspace packages for Vite monorepo mode.',
    );
  });

  test('recognizes graph files under monorepo packages', () => {
    const source = new MonorepoPackageSource({
      root: project.root,
      styleExtensions: ['.css'],
      readWorkspacePackages: () => [
        {
          name: '@scope/app',
          path: project.resolve('apps/app'),
        },
      ],
    });
    const isGraphFile = (relativePath: string) =>
      source.isSourceGraphFile(project.resolve('apps/app', relativePath));

    expect(isGraphFile('auklet.config.js')).toBe(true);
    expect(isGraphFile('src/Button.tsx')).toBe(true);
    expect(isGraphFile('src/Button.css')).toBe(true);
    expect(isGraphFile('src/Button.ts')).toBe(false);
    expect(source.isSourceGraphFile(project.resolve('README.md'))).toBe(false);
  });
});
