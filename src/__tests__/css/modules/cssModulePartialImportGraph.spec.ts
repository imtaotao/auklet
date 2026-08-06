import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createCssModulePartialImportGraph } from '#auklet/css/modules/cssModulePartialImportGraph';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

describe('CssModulePartialImportGraph', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-import-graph-');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  test('reads each source file once when dependencies are shared', () => {
    const entry = project.writeFile(
      'src/Tag.module.less',
      '@import "./a.less";\n@import "./b.less";\n.tag {}',
    );
    project.writeFile('src/a.less', '@import "./base.css";\n.a {}');
    project.writeFile('src/b.less', '@import "./base.css";\n.b {}');
    project.writeFile('src/base.css', ':root { --tag-color: teal; }');
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const graph = createCssModulePartialImportGraph(entry, {
      sourceRoot: project.resolve('src'),
    });

    expect(graph.nodes.size).toBe(4);
    for (const file of [
      entry,
      project.resolve('src/a.less'),
      project.resolve('src/b.less'),
      project.resolve('src/base.css'),
    ]) {
      const reads = readSpy.mock.calls.filter(
        ([readFile]) => path.resolve(String(readFile)) === file,
      );
      expect(reads).toHaveLength(1);
    }
  });

  test.each([
    ['Tag.module.css', 'Other.module.css'],
    ['Tag.module.less', 'Other.module.css'],
    ['Tag.module.less', 'Other.module.less'],
  ])('rejects %s importing %s', (entryName, importedName) => {
    const entry = project.writeFile(
      `src/${entryName}`,
      `@import "./${importedName}";\n.tag {}`,
    );
    project.writeFile(`src/${importedName}`, '.other {}');

    expect(() =>
      createCssModulePartialImportGraph(entry, {
        sourceRoot: project.resolve('src'),
      }),
    ).toThrow(
      `[css] CSS Modules files must not import other CSS Modules files: ./${importedName} from ${entry}`,
    );
  });

  test('rejects nested imports of another CSS Module', () => {
    const entry = project.writeFile(
      'src/Tag.module.less',
      '@import "./theme.less";\n.tag {}',
    );
    const theme = project.writeFile(
      'src/theme.less',
      '@import "./Other.module.css";\n.theme {}',
    );
    project.writeFile('src/Other.module.css', '.other {}');

    expect(() =>
      createCssModulePartialImportGraph(entry, {
        sourceRoot: project.resolve('src'),
      }),
    ).toThrow(
      `[css] CSS Modules files must not import other CSS Modules files: ./Other.module.css from ${theme}`,
    );
  });

  test.each(['inline', 'reference'])(
    'rejects the Less %s option in .module.css imports',
    (option) => {
      const entry = project.writeFile(
        'src/Tag.module.css',
        `@import (${option}) "./tokens.css";\n.tag {}`,
      );
      project.writeFile('src/tokens.css', ':root {}');

      expect(() =>
        createCssModulePartialImportGraph(entry, {
          sourceRoot: project.resolve('src'),
        }),
      ).toThrow(
        `[css] CSS imports must not use Less options (${option}): ./tokens.css from ${entry}`,
      );
    },
  );

  test('rejects .module.css importing plain Less', () => {
    const entry = project.writeFile(
      'src/Tag.module.css',
      '@import "./tokens.less";\n.tag {}',
    );
    project.writeFile('src/tokens.less', '@tag-color: teal;');

    expect(() =>
      createCssModulePartialImportGraph(entry, {
        sourceRoot: project.resolve('src'),
      }),
    ).toThrow(
      `[css] CSS Modules partial imports must be local .css files: ./tokens.less from ${entry}`,
    );
  });

  test('rejects Less import options in nested CSS partials', () => {
    const entry = project.writeFile(
      'src/Tag.module.less',
      '@import "./theme.css";\n.tag {}',
    );
    const theme = project.writeFile(
      'src/theme.css',
      '@import (inline) "./tokens.css";\n.theme {}',
    );
    project.writeFile('src/tokens.css', ':root {}');

    expect(() =>
      createCssModulePartialImportGraph(entry, {
        sourceRoot: project.resolve('src'),
      }),
    ).toThrow(
      `[css] CSS imports must not use Less options (inline): ./tokens.css from ${theme}`,
    );
  });
});
