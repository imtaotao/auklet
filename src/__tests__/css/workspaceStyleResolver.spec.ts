import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

describe('WorkspaceStyleResolver', () => {
  let project: VirtualProject;
  let resolver: WorkspaceStyleResolver;

  beforeEach(() => {
    project = createVirtualProject('auklet-resolver-');
    project.writePackageJson({ name: 'fixture-package' });

    resolver = new WorkspaceStyleResolver(moduleStyleBuildConfig, {
      packageRoot: project.root,
      sourceDir: project.resolve('src'),
      outputDir: project.resolve('dist'),
    });
  });

  afterEach(() => {
    project.cleanup();
  });

  const resolve = (specifier: string, fromDir?: string) => {
    return resolver.resolveStyleDependency(specifier, fromDir);
  };

  const realResolve = (specifier: string) => {
    return fs.realpathSync(resolve(specifier));
  };

  const output = (specifier: string, outRoot = project.resolve('dist/lib')) => {
    return resolver.toOutputStyleSpecifier(specifier, outRoot);
  };

  const external = (
    specifier: string,
    outRoot = project.resolve('dist/lib'),
  ) => {
    return resolver.toExternalStyleSpecifier(specifier, outRoot);
  };

  test('resolves relative style dependencies from the importing directory', () => {
    const fromDir = project.resolve('src/components/Button');

    expect(resolve('./index.css', fromDir)).toBe(
      path.join(fromDir, 'index.css'),
    );
  });

  test('resolves package style dependencies with Node resolution first', () => {
    const packageStyle = project.resolve('node_modules/@scope/ui/style.css');
    project.writeFile('node_modules/@scope/ui/style.css', '');

    expect(realResolve('@scope/ui/style.css')).toBe(
      fs.realpathSync(packageStyle),
    );
  });

  test('resolves package exports for stable style entry paths', () => {
    const packageRoot = project.resolve('node_modules/@scope/ui');
    const styleFile = path.join(
      packageRoot,
      'dist/lib/components/Button/style/index.css',
    );
    project.writeFile(
      'node_modules/@scope/ui/dist/lib/components/Button/style/index.css',
      '',
    );
    project.writeJson('node_modules/@scope/ui/package.json', {
      name: '@scope/ui',
      exports: {
        './*.css': {
          import: './dist/es/*/style/index.css',
          require: './dist/lib/*/style/index.css',
          default: './dist/es/*/style/index.css',
        },
      },
    });

    expect(realResolve('@scope/ui/components/Button.css')).toBe(
      fs.realpathSync(styleFile),
    );
  });

  test('falls back to package node_modules path when Node resolution misses', () => {
    expect(resolve('@scope/ui/missing.css')).toBe(
      project.resolve('node_modules/@scope/ui/missing.css'),
    );
  });

  test('rewrites package style specifiers to the current output format', () => {
    expect(output('@scope/ui/es/components/Button/style/index.css')).toBe(
      '@scope/ui/lib/components/Button/style/index.css',
    );
  });

  test('keeps relative and non-output package specifiers unchanged', () => {
    expect(output('../Button.css')).toBe('../Button.css');
    expect(output('@scope/ui/style.css')).toBe('@scope/ui/style.css');
  });

  test('rewrites package style entry specifiers to external style entries', () => {
    expect(external('@scope/ui/style.css')).toBe('@scope/ui/external.css');
    expect(external('@scope/ui/es/style/index.css')).toBe(
      '@scope/ui/lib/style/external.css',
    );
    expect(external('katex/dist/katex.min.css')).toBe(
      'katex/dist/katex.min.css',
    );
  });
});
