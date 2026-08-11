import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createGenerateScopedName,
  generateScopedName,
} from '#auklet/css/modules/generateScopedName';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('generateScopedName', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-scoped-name-');
    project.writePackageJson({ name: '@scope/ui', version: '0.0.1' });
  });

  afterEach(() => {
    project.cleanup();
  });

  test('hashes package name + source-relative path + local name', () => {
    const file = project.writeFile('src/shared/chip.module.less', '.chip {}\n');
    const scoped = createGenerateScopedName({
      packageRoot: project.root,
      sourceRoot: project.resolve('src'),
    })('chip', file, '');

    expect(scoped).toMatch(/^chip_chip_[A-Za-z0-9_-]{6}$/);
    expect(
      createGenerateScopedName({
        packageRoot: project.root,
        sourceRoot: project.resolve('src'),
      })('chip', file, ''),
    ).toBe(scoped);
  });

  test('same relative path under different absolute roots shares hash', () => {
    const other = createVirtualProject('auklet-scoped-name-other-');
    try {
      other.writePackageJson({ name: '@scope/ui', version: '0.0.1' });
      const relative = 'src/shared/chip.module.less';
      const left = project.writeFile(relative, '.chip {}\n');
      const right = other.writeFile(relative, '.chip {}\n');
      expect(path.resolve(left)).not.toBe(path.resolve(right));

      const hashAt = (root: VirtualProject, file: string) =>
        createGenerateScopedName({
          packageName: '@scope/ui',
          sourceRoot: root.resolve('src'),
        })('chip', file, '');

      expect(hashAt(project, left)).toBe(hashAt(other, right));
    } finally {
      other.cleanup();
    }
  });

  test('default generateScopedName stays stable for the same package file', () => {
    const file = project.writeFile('src/Tag.module.css', '.tag {}\n');
    expect(generateScopedName('tag', file, '')).toBe(
      generateScopedName('tag', file, ''),
    );
  });

  test('hash is stable across process cwd when roots are provided', () => {
    const file = project.writeFile('src/shared/chip.module.less', '.chip {}\n');
    const sourceRoot = project.resolve('src');
    const gen = createGenerateScopedName({
      packageRoot: project.root,
      sourceRoot,
    });
    const expected = gen('chip', file, '');
    const previousCwd = process.cwd();
    process.chdir(project.root);
    try {
      expect(
        createGenerateScopedName({
          packageRoot: project.root,
          sourceRoot,
        })('chip', file, ''),
      ).toBe(expected);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
