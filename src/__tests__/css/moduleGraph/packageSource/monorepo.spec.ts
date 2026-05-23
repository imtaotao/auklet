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
      packagesDir: 'packages',
      styleExtensions: ['.css'],
    });
  };

  const packagePath = (relativePath: string) => {
    return project.resolve('packages', relativePath);
  };

  test('discovers named packages from the monorepo packages directory', () => {
    project.writeJson('packages/app/package.json', { name: '@scope/app' });
    project.writeJson('packages/ui/package.json', { name: '@scope/ui' });
    project.writeJson('packages/anonymous/package.json', {});
    project.writeFile('packages/not-a-package/README.md', '');

    const source = createSource();

    expect(source.getPackages()).toEqual([
      {
        packageName: '@scope/app',
        packageRoot: path.join(project.root, 'packages/app'),
      },
      {
        packageName: '@scope/ui',
        packageRoot: path.join(project.root, 'packages/ui'),
      },
    ]);
    expect(source.getPackageNames()).toEqual(['@scope/app', '@scope/ui']);
    expect(source.isKnownPackageName('@scope/ui')).toBe(true);
    expect(source.isKnownPackageName('@scope/missing')).toBe(false);
  });

  test('returns empty packages when the packages directory is missing', () => {
    const source = createSource();

    expect(source.getPackages()).toEqual([]);
    expect(source.getPackageNames()).toEqual([]);
  });

  test('returns current monorepo watch roots', async () => {
    const source = createSource();

    expect(await source.getWatchRoots()).toEqual([
      path.join(project.root, 'packages/*/src'),
      path.join(project.root, 'packages/*/auklet.config.ts'),
    ]);
  });

  test('recognizes graph files under monorepo packages', () => {
    const source = createSource();
    const isGraphFile = (relativePath: string) => {
      return source.isSourceGraphFile(packagePath(relativePath));
    };

    expect(isGraphFile('app/auklet.config.ts')).toBe(true);
    expect(isGraphFile('app/src/Button.tsx')).toBe(true);
    expect(isGraphFile('app/src/Button.css')).toBe(true);
    expect(isGraphFile('app/src/Button.ts')).toBe(false);
    expect(source.isSourceGraphFile(project.resolve('README.md'))).toBe(false);
  });
});
