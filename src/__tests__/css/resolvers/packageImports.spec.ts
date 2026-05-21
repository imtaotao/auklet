import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolvePackageImportsSourceImport } from '#auklet/css/core/resolvers/packageImports';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

const widgetImport = '#widgets/components/EnglishCards';
const widgetSourcePath = path.join('widgets', 'components', 'EnglishCards');

type PackageJson = Parameters<VirtualProject['writePackageJson']>[0];
type PackageImports = NonNullable<PackageJson['imports']>;

describe('resolvePackageImportsSourceImport', () => {
  let project: VirtualProject;
  let sourceRoot: string;

  beforeEach(() => {
    project = createVirtualProject('auklet-package-imports-');
    sourceRoot = project.resolve('src');
  });

  afterEach(() => {
    project.cleanup();
  });

  const writePackageImports = (imports: PackageImports) => {
    project.writePackageJson({ imports });
  };

  const resolveImport = (importPath = widgetImport) => {
    return resolvePackageImportsSourceImport(
      project.root,
      sourceRoot,
      importPath,
    );
  };

  test('uses the source condition when package imports are conditional', () => {
    writePackageImports({
      '#widgets/*': {
        source: './src/widgets/*',
        import: './dist/es/widgets/*.js',
        default: './dist/es/widgets/*.js',
      },
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('supports package imports targets with source file extensions', () => {
    writePackageImports({
      '#widgets/*': {
        source: './src/widgets/*.tsx',
        import: './dist/es/widgets/*.js',
        default: './dist/es/widgets/*.js',
      },
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('ignores package imports targets outside the source root', () => {
    writePackageImports({
      '#widgets/*': {
        import: './dist/es/widgets/*.js',
        default: './dist/es/widgets/*.js',
      },
    });

    expect(resolveImport()).toEqual([]);
  });

  test('ignores external package imports targets', () => {
    writePackageImports({
      '#external': 'external-pkg/feature',
    });

    expect(resolveImport('#external')).toEqual([]);
  });

  test('ignores unknown and non-package-import specifiers', () => {
    writePackageImports({
      '#widgets/*': './src/widgets/*',
    });

    for (const importPath of ['#unknown', '@scope/ui/components/Card']) {
      expect(resolveImport(importPath)).toEqual([]);
    }
  });

  test('refreshes package imports mappings in the same process', () => {
    writePackageImports({
      '#widgets/*': './dist/es/widgets/*.js',
    });

    expect(resolveImport()).toEqual([]);

    writePackageImports({
      '#widgets/*': {
        source: './src/widgets/*',
        import: './dist/es/widgets/*.js',
        default: './dist/es/widgets/*.js',
      },
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('treats invalid package json as no package imports', () => {
    project.writeFile('package.json', '{');

    expect(resolveImport()).toEqual([]);
  });
});
