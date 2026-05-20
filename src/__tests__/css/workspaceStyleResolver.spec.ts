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

  test('resolves relative style dependencies from the importing directory', () => {
    const fromDir = project.resolve('src/components/Button');

    expect(resolver.resolveStyleDependency('./index.css', fromDir)).toBe(
      path.join(fromDir, 'index.css'),
    );
  });

  test('resolves package style dependencies with Node resolution first', () => {
    const packageStyle = project.resolve('node_modules/@scope/ui/style.css');
    project.writeFile('node_modules/@scope/ui/style.css', '');

    expect(
      fs.realpathSync(resolver.resolveStyleDependency('@scope/ui/style.css')),
    ).toBe(fs.realpathSync(packageStyle));
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

    expect(
      fs.realpathSync(
        resolver.resolveStyleDependency('@scope/ui/components/Button.css'),
      ),
    ).toBe(fs.realpathSync(styleFile));
  });

  test('falls back to package node_modules path when Node resolution misses', () => {
    expect(resolver.resolveStyleDependency('@scope/ui/missing.css')).toBe(
      project.resolve('node_modules/@scope/ui/missing.css'),
    );
  });

  test('rewrites package style specifiers to the current output format', () => {
    const outRoot = project.resolve('dist/lib');

    expect(
      resolver.toOutputStyleSpecifier(
        '@scope/ui/es/components/Button/style/index.css',
        outRoot,
      ),
    ).toBe('@scope/ui/lib/components/Button/style/index.css');
  });

  test('keeps relative and non-output package specifiers unchanged', () => {
    const outRoot = project.resolve('dist/lib');

    expect(resolver.toOutputStyleSpecifier('../Button.css', outRoot)).toBe(
      '../Button.css',
    );
    expect(
      resolver.toOutputStyleSpecifier('@scope/ui/style.css', outRoot),
    ).toBe('@scope/ui/style.css');
  });

  test('rewrites package style entry specifiers to external style entries', () => {
    const outRoot = project.resolve('dist/lib');

    expect(
      resolver.toExternalStyleSpecifier('@scope/ui/style.css', outRoot),
    ).toBe('@scope/ui/external.css');
    expect(
      resolver.toExternalStyleSpecifier(
        '@scope/ui/es/style/index.css',
        outRoot,
      ),
    ).toBe('@scope/ui/lib/style/external.css');
    expect(
      resolver.toExternalStyleSpecifier('katex/dist/katex.min.css', outRoot),
    ).toBe('katex/dist/katex.min.css');
  });
});
