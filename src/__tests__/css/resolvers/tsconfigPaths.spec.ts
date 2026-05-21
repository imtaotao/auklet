import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveTsconfigPathsSourceImport } from '#auklet/css/core/resolvers/tsconfigPaths';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

const packageDir = path.join('packages', 'ui');
const widgetImport = '#widgets/components/EnglishCards';
const widgetSourcePath = path.join('components', 'EnglishCards');

type JsonValue = Parameters<VirtualProject['writeJson']>[1];

describe('resolveTsconfigPathsSourceImport', () => {
  let project: VirtualProject;
  let sourceRoot: string;
  let packageRoot: string;

  beforeEach(() => {
    project = createVirtualProject('auklet-tsconfig-paths-');
    packageRoot = project.resolve(packageDir);
    sourceRoot = project.resolve(packageDir, 'src');
  });

  afterEach(() => {
    project.cleanup();
  });

  const writeCompilerOptions = (
    relativePath: string,
    compilerOptions: JsonValue,
  ) => {
    project.writeJson(relativePath, { compilerOptions });
  };

  const resolveImport = (importPath = widgetImport) => {
    return resolveTsconfigPathsSourceImport(
      packageRoot,
      sourceRoot,
      importPath,
    );
  };

  test('resolves aliases from a package tsconfig', () => {
    writeCompilerOptions(path.join(packageDir, 'tsconfig.json'), {
      baseUrl: '.',
      paths: {
        '#widgets/*': ['./src/*'],
      },
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('resolves aliases from an ancestor tsconfig', () => {
    writeCompilerOptions('tsconfig.json', {
      baseUrl: '.',
      paths: {
        '#widgets/*': ['./packages/ui/src/*'],
      },
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('ignores aliases that resolve outside the source root', () => {
    writeCompilerOptions('tsconfig.json', {
      baseUrl: '.',
      paths: {
        '#content/*': ['./packages/content/src/*'],
      },
    });

    expect(resolveImport('#content/components/CodeBlock')).toEqual([]);
  });

  test('supports exact path aliases and trims source file extensions', () => {
    writeCompilerOptions(path.join(packageDir, 'tsconfig.json'), {
      baseUrl: '.',
      paths: {
        '#entry': ['./src/components/Entry.tsx'],
      },
    });

    expect(resolveImport('#entry')).toEqual([path.join('components', 'Entry')]);
  });

  test('prefers more specific path mappings before broad mappings', () => {
    writeCompilerOptions(path.join(packageDir, 'tsconfig.json'), {
      baseUrl: '.',
      paths: {
        '#widgets/*': ['./src/fallback/*'],
        '#widgets/components/*': ['./src/components/*'],
      },
    });

    expect(resolveImport()).toEqual([
      widgetSourcePath,
      path.join('fallback', 'components', 'EnglishCards'),
    ]);
  });

  test('uses tsconfig extends when paths are inherited', () => {
    writeCompilerOptions('tsconfig.base.json', {
      baseUrl: '.',
      paths: {
        '#widgets/*': ['./packages/ui/src/*'],
      },
    });
    project.writeJson(path.join(packageDir, 'tsconfig.json'), {
      extends: '../../tsconfig.base.json',
    });

    expect(resolveImport()).toEqual([widgetSourcePath]);
  });

  test('returns no candidates when tsconfig is missing or invalid', () => {
    expect(resolveImport()).toEqual([]);

    project.writeFile(path.join(packageDir, 'tsconfig.json'), '{');

    expect(resolveImport()).toEqual([]);
  });
});
