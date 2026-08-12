import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createExternalLessDependencyGraph,
  createLessExternalImportPlan,
} from '#auklet/css/core/externalLessGraph';
import { parseLessSourceImports } from '#auklet/css/core/lessImportGraph';
import {
  findPackageRootForFile,
  resolveExternalLessImport,
} from '#auklet/css/core/resolvers/externalLess';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('external Less resolver', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-external-less-resolver-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('findPackageRootForFile ignores Vite virtual module ids with null bytes', () => {
    for (const virtualId of [
      '\0virtual:mf:__mfe_internal__host__loadShare__react__loadShare__.js',
      '\0vite/preload-helper.js',
      '\0plugin-vue:export-helper',
      '\0auklet-css:@scope/app/style.css',
    ]) {
      expect(findPackageRootForFile(virtualId)).toBeNull();
    }
  });

  test('resolves exports patterns with Less condition priority and respects null entries', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      dependencies: { tokens: '1.0.0' },
    });
    project.writeJson('node_modules/tokens/package.json', {
      name: 'tokens',
      exports: {
        './private/*': null,
        './*': {
          less: './less/*',
          source: './source/*',
          import: './import/*',
          default: './default/*',
        },
      },
    });
    const lessFile = project.writeFile(
      'node_modules/tokens/less/theme.less',
      '@brand: teal;',
    );
    project.writeFile('node_modules/tokens/source/theme.less', '@brand: red;');

    expect(
      resolveExternalLessImport('tokens/theme.less', project.root).file,
    ).toBe(lessFile);
    expect(() =>
      resolveExternalLessImport('tokens/private/theme.less', project.root),
    ).toThrow('not exported');
  });

  test.each([
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const)('accepts packages declared in %s', (field) => {
    project.writeJson('package.json', {
      name: 'consumer',
      [field]: { tokens: '1.0.0' },
    });
    project.writeJson('node_modules/tokens/package.json', {
      name: 'tokens',
      exports: { '.': './theme.less' },
    });
    const file = project.writeFile(
      'node_modules/tokens/theme.less',
      '@brand: teal;',
    );

    expect(resolveExternalLessImport('tokens', project.root).file).toBe(file);
  });

  test('rejects npm aliases when the package name does not match the dependency key', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      dependencies: { alias: '1.0.0' },
    });
    project.writeJson('node_modules/alias/package.json', {
      name: 'real-tokens',
      exports: { '.': './theme.less' },
    });
    project.writeFile('node_modules/alias/theme.less', '@brand: teal;');

    expect(() => resolveExternalLessImport('alias', project.root)).toThrow(
      'must match the import/dependency name',
    );
  });

  test('rejects importing the current package by its own package.json#name', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      exports: {
        './theme.less': './src/theme.less',
      },
    });
    project.writeFile('src/theme.less', '@brand: teal;');

    expect(() =>
      resolveExternalLessImport('consumer/theme.less', project.root),
    ).toThrow('cannot target the importing package itself');
  });

  test('rejects package.json#imports specifiers for external Less', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      imports: {
        '#tokens/*.less': './src/tokens/*.less',
      },
    });
    project.writeFile('src/tokens/theme.less', '@brand: teal;');

    expect(() =>
      resolveExternalLessImport('#tokens/theme.less', project.root),
    ).toThrow('do not support package.json#imports');
  });

  test('rejects package.json#imports Less references from the import plan', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      imports: {
        '#tokens/*.less': './src/tokens/*.less',
      },
    });
    project.writeFile('src/tokens/theme.less', '@brand: teal;');
    const entry = project.writeFile(
      'src/entry.less',
      '@import (reference) "#tokens/theme.less";\n.app { color: @brand; }',
    );

    expect(() =>
      createLessExternalImportPlan({
        entryFile: entry,
        packageRoot: project.root,
        source: fs.readFileSync(entry, 'utf8'),
        sourceRoot: project.resolve('src'),
      }),
    ).toThrow(
      '[css] external Less imports do not support package.json#imports:',
    );
  });

  test('rejects tsconfig path aliases for external Less', () => {
    project.writeJson('package.json', { name: 'consumer' });
    project.writeJson('tsconfig.json', {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
      },
    });
    project.writeFile('src/tokens/theme.less', '@brand: teal;');

    expect(() =>
      resolveExternalLessImport('@/tokens/theme.less', project.root),
    ).toThrow('do not support tsconfig paths');
  });

  test('rejects undeclared packages and packages without exports', () => {
    project.writeJson('package.json', { name: 'consumer' });
    project.writeJson('node_modules/tokens/package.json', {
      name: 'tokens',
    });
    project.writeFile('node_modules/tokens/theme.less', '@brand: teal;');

    expect(() =>
      resolveExternalLessImport('tokens/theme.less', project.root),
    ).toThrow('direct dependency');

    project.writeJson('package.json', {
      name: 'consumer',
      dependencies: { tokens: '1.0.0' },
    });
    expect(() =>
      resolveExternalLessImport('tokens/theme.less', project.root),
    ).toThrow('must define exports');
  });

  test('rejects a logical Less export whose real target is CSS', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      dependencies: { tokens: '1.0.0' },
    });
    project.writeJson('node_modules/tokens/package.json', {
      name: 'tokens',
      exports: { './theme.less': './theme.less' },
    });
    const cssFile = project.writeFile(
      'node_modules/tokens/internal.css',
      ':root { --brand: teal; }',
    );
    const exportFile = project.resolve('node_modules/tokens/theme.less');
    fs.symlinkSync(path.basename(cssFile), exportFile, 'file');

    expect(() =>
      resolveExternalLessImport('tokens/theme.less', project.root),
    ).toThrow('published .less file');
  });

  test('builds the recursive provider graph and records every exports manifest', () => {
    project.writeJson('package.json', {
      name: 'consumer',
      dependencies: { tokens: '1.0.0' },
    });
    project.writeJson('node_modules/tokens/package.json', {
      name: 'tokens',
      dependencies: { palette: '1.0.0' },
      exports: { '.': './index.less' },
    });
    const tokensFile = project.writeFile(
      'node_modules/tokens/index.less',
      '@import (reference) "palette";\n@import "./local.less";',
    );
    const localFile = project.writeFile(
      'node_modules/tokens/local.less',
      '@spacing: 8px;',
    );
    project.writeJson('node_modules/tokens/node_modules/palette/package.json', {
      name: 'palette',
      exports: { '.': './index.less' },
    });
    const paletteFile = project.writeFile(
      'node_modules/tokens/node_modules/palette/index.less',
      '@brand: teal;',
    );
    const consumerFile = project.writeFile('src/index.less', '');
    const parsedImport = parseLessSourceImports(
      '@import (reference) "tokens";',
    )[0]!;

    const graph = createExternalLessDependencyGraph({
      import: parsedImport,
      importerFile: consumerFile,
      importerPackageRoot: project.root,
    });

    expect(Array.from(graph.nodes.values()).map((node) => node.file)).toEqual(
      expect.arrayContaining([tokensFile, localFile, paletteFile]),
    );
    expect(Array.from(graph.packageJsonFiles)).toEqual(
      expect.arrayContaining([
        project.resolve('node_modules/tokens/package.json'),
        project.resolve(
          'node_modules/tokens/node_modules/palette/package.json',
        ),
      ]),
    );
    expect(graph.resolveImport('palette', tokensFile)).toBe(paletteFile);

    const plan = createLessExternalImportPlan({
      entryFile: consumerFile,
      packageRoot: project.root,
      source: '@import (reference) "tokens";',
    });
    expect(plan.packageNames).toEqual(
      expect.arrayContaining(['tokens', 'palette']),
    );
  });
});
