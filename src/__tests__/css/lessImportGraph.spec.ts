import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  assertCssModulePlainImport,
  hasLessImportOption,
  isInlineLessImport,
  mapPreservedLessImportToCssSpecifier,
  parseLessSourceImports,
  resolveLocalStyleImport,
  rewriteLessImportAsReference,
  rewriteLessImportSpecifier,
  type LessSourceImport,
} from '#auklet/css/core/lessImportGraph';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const importOf = (
  partial: Partial<LessSourceImport> & Pick<LessSourceImport, 'specifier'>,
) =>
  ({
    start: 0,
    end: 0,
    options: null,
    quote: '"',
    tail: null,
    ...partial,
  }) satisfies LessSourceImport;

describe('lessImportGraph', () => {
  test.each([
    ['double-quoted', '@import "./a.less";', './a.less', null, '"', null],
    ['single-quoted', "@import './a.less';", './a.less', null, "'", null],
    [
      'reference option',
      '@import (reference) "./a.less";',
      './a.less',
      'reference',
      '"',
      null,
    ],
    [
      'optional reference',
      '@import (optional, reference) "tokens/theme.less";',
      'tokens/theme.less',
      'optional, reference',
      '"',
      null,
    ],
    [
      'multiple reference',
      '@import (multiple, reference) "./a.less";',
      './a.less',
      'multiple, reference',
      '"',
      null,
    ],
    ['unquoted url()', '@import url(./a.less);', './a.less', null, '"', null],
    [
      'double-quoted url()',
      '@import url("./a.less");',
      './a.less',
      null,
      '"',
      null,
    ],
    [
      'single-quoted url()',
      "@import url('./a.less');",
      './a.less',
      null,
      "'",
      null,
    ],
    [
      'quoted url() with options',
      '@import (reference) url("./a.less");',
      './a.less',
      'reference',
      '"',
      null,
    ],
    [
      'url() with options and layer tail',
      '@import (reference) url("./a.less") layer(base);',
      './a.less',
      'reference',
      '"',
      'layer(base)',
    ],
    [
      'supports tail',
      '@import "./a.less" supports(display: grid);',
      './a.less',
      null,
      '"',
      'supports(display: grid)',
    ],
    [
      'layer and media tails',
      '@import "./a.less" layer(base) screen and (min-width: 640px);',
      './a.less',
      null,
      '"',
      'layer(base) screen and (min-width: 640px)',
    ],
    [
      'package specifier',
      '@import (reference) "tokens/theme.less";',
      'tokens/theme.less',
      'reference',
      '"',
      null,
    ],
    [
      'hash specifier',
      '@import "#local/a.css";',
      '#local/a.css',
      null,
      '"',
      null,
    ],
  ] as const)(
    'parses %s imports',
    (_name, source, specifier, options, quote, tail) => {
      expect(parseLessSourceImports(source)).toEqual([
        expect.objectContaining({
          specifier,
          options,
          quote,
          tail,
          start: 0,
          end: source.length,
        }),
      ]);
    },
  );

  test('parses multiple imports in source order', () => {
    const source = [
      '@import "./a.less";',
      '@import (inline) "./b.css";',
      '@import url("./c.less") layer(base);',
    ].join('\n');

    expect(
      parseLessSourceImports(source).map((item) => ({
        specifier: item.specifier,
        options: item.options,
        tail: item.tail,
      })),
    ).toEqual([
      { specifier: './a.less', options: null, tail: null },
      { specifier: './b.css', options: 'inline', tail: null },
      { specifier: './c.less', options: null, tail: 'layer(base)' },
    ]);
  });

  test('ignores @import inside line and block comments', () => {
    const source = [
      '// @import "./ghost-line.less";',
      '/* @import "./ghost-block.less"; */',
      '@import "./real.less";',
    ].join('\n');

    expect(
      parseLessSourceImports(source).map((item) => item.specifier),
    ).toEqual(['./real.less']);
  });

  test('keeps rewrite offsets valid when comments precede an import', () => {
    const source = [
      '// @import "./ghost.less";',
      '@import "./tokens.less";',
      '.entry { color: red; }',
    ].join('\n');
    const [parsed] = parseLessSourceImports(source);
    expect(parsed).toBeTruthy();

    const rewritten = rewriteLessImportAsReference(parsed!);
    expect(rewritten).toBe('@import (reference) "./tokens.less";');
    expect(source.slice(parsed!.start, parsed!.end)).toBe(
      '@import "./tokens.less";',
    );
  });

  test('does not treat comment markers inside strings as comments', () => {
    const source = [
      '.x { content: "/* @import \\"./ghost.less\\"; */"; }',
      '@import "./real.less";',
    ].join('\n');

    expect(
      parseLessSourceImports(source).map((item) => item.specifier),
    ).toEqual(['./real.less']);
  });

  test('ignores semicolon-less imports recovered as following rules', () => {
    expect(
      parseLessSourceImports('@import "./a.less"\n.x { color: red; }'),
    ).toEqual([]);
  });

  test.each([
    ['null options', null, 'reference', false],
    ['matching option', 'optional, reference', 'reference', true],
    ['non-matching option', 'inline', 'reference', false],
  ] as const)(
    'hasLessImportOption handles %s',
    (_name, options, expected, result) => {
      expect(hasLessImportOption(options, expected)).toBe(result);
    },
  );

  test('isInlineLessImport detects inline option', () => {
    expect(isInlineLessImport('inline')).toBe(true);
    expect(isInlineLessImport('reference')).toBe(false);
  });

  test.each([
    [
      'adds reference to plain imports',
      importOf({ specifier: './a.less' }),
      '@import (reference) "./a.less";',
    ],
    [
      'keeps existing non-reference options when adding reference',
      importOf({
        specifier: './a.less',
        options: 'multiple',
        quote: "'",
        tail: 'layer(base)',
      }),
      "@import (reference, multiple) './a.less' layer(base);",
    ],
    [
      'returns null when reference is already present',
      importOf({
        specifier: './a.less',
        options: 'optional, reference',
      }),
      null,
    ],
    [
      'returns null for inline imports',
      importOf({
        specifier: './a.css',
        options: 'inline',
      }),
      null,
    ],
  ] as const)('rewriteLessImportAsReference %s', (_name, parsed, result) => {
    expect(rewriteLessImportAsReference(parsed)).toBe(result);
  });

  test('rewriteLessImportSpecifier preserves options quote and tail', () => {
    expect(
      rewriteLessImportSpecifier(
        importOf({
          specifier: './old.less',
          options: 'reference',
          quote: "'",
          tail: 'layer(base)',
        }),
        './new.less',
      ),
    ).toBe("@import (reference) './new.less' layer(base);");
  });

  test('assertCssModulePlainImport rejects conditional tails', () => {
    expect(() =>
      assertCssModulePlainImport(
        importOf({
          specifier: './a.less',
          tail: 'layer(base)',
        }),
        '/tmp/Tag.module.less',
      ),
    ).toThrow('do not support conditional @import');

    expect(() =>
      assertCssModulePlainImport(
        importOf({ specifier: './a.less' }),
        '/tmp/Tag.module.less',
      ),
    ).not.toThrow();
  });

  test('mapPreservedLessImportToCssSpecifier rewrites less to css relatives', () => {
    expect(
      mapPreservedLessImportToCssSpecifier(
        '/pkg/src/tokens.less',
        '/pkg/src/entry.less',
      ),
    ).toBe('./tokens.css');
  });
});

describe('resolveLocalStyleImport', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-less-import-resolve-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('resolves relative files and extensionless less/css candidates', () => {
    const fromDir = project.resolve('src');
    const lessFile = project.writeFile('src/tokens.less', '@brand: teal;');
    const cssFile = project.writeFile('src/base.css', '.base {}');
    const outsideFile = project.writeFile('outside.less', '@brand: red;');

    expect(resolveLocalStyleImport('./tokens.less', fromDir)).toBe(lessFile);
    expect(resolveLocalStyleImport('./tokens', fromDir)).toBe(lessFile);
    expect(resolveLocalStyleImport('./base', fromDir)).toBe(cssFile);
    expect(resolveLocalStyleImport('../outside.less', fromDir)).toBe(
      outsideFile,
    );
  });

  test('returns null for non-relative or missing imports', () => {
    const fromDir = project.resolve('src');
    project.writeFile('src/tokens.less', '@brand: teal;');

    expect(resolveLocalStyleImport('tokens/theme.less', fromDir)).toBeNull();
    expect(resolveLocalStyleImport('#local/tokens.less', fromDir)).toBeNull();
    expect(resolveLocalStyleImport('./missing.less', fromDir)).toBeNull();
    expect(resolveLocalStyleImport('./missing', fromDir)).toBeNull();
  });
});
