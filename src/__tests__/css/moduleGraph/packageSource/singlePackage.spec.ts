import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SinglePackageSource } from '#auklet/css/vite/moduleGraph/packageSource/singlePackage';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../../fixtures/virtualProject';

describe('SinglePackageSource', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-single-package-source-');
  });

  afterEach(() => {
    project.cleanup();
  });

  const createSource = () => {
    return new SinglePackageSource({
      root: project.root,
      styleExtensions: ['.css'],
    });
  };

  const isGraphFile = (relativePath: string) => {
    return createSource().isSourceGraphFile(project.resolve(relativePath));
  };

  test('uses the current package as the only style package', () => {
    project.writePackageJson({ name: '@scope/app' });

    const source = createSource();

    expect(source.getPackages()).toEqual([
      {
        packageName: '@scope/app',
        packageRoot: project.root,
      },
    ]);
    expect(source.getPackageNames()).toEqual(['@scope/app']);
    expect(source.isKnownPackageName('@scope/app')).toBe(true);
    expect(source.isKnownPackageName('@scope/ui')).toBe(false);
  });

  test('requires a named package.json in package mode', () => {
    expect(() => createSource().getPackageNames()).toThrow(
      'requires a package.json',
    );

    project.writePackageJson({});

    expect(() => createSource().getPackageNames()).toThrow(
      'requires package.json#name',
    );
  });

  test('returns single package watch roots from configured source', async () => {
    project.writePackageJson({ name: '@scope/app' });
    const loadAukletConfig = vi.fn(async () => ({ source: 'source' }));
    const source = new SinglePackageSource({
      root: project.root,
      styleExtensions: ['.css'],
      loadAukletConfig,
    });

    expect(await source.getWatchRoots()).toEqual([
      path.join(project.root, 'source'),
      path.join(project.root, 'auklet.config.js'),
      path.join(project.root, 'auklet.config.mjs'),
    ]);
    expect(loadAukletConfig).toHaveBeenCalledWith(project.root, {
      cacheBust: true,
    });
  });

  test('recognizes graph files under the package root', () => {
    project.writePackageJson({ name: '@scope/app' });

    expect(isGraphFile('auklet.config.js')).toBe(true);
    expect(isGraphFile('src/Button.tsx')).toBe(true);
    expect(isGraphFile('src/Button.css')).toBe(true);
    expect(isGraphFile('src/Button.ts')).toBe(false);
    expect(
      createSource().isSourceGraphFile(
        path.join(path.dirname(project.root), 'outside.css'),
      ),
    ).toBe(false);
  });
});
