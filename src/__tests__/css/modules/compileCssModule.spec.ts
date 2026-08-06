import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  compileCssModule,
  createCssModuleLocalsViteLoadCode,
} from '#auklet/css/modules/compileCssModule';
import { createCssModuleDevStyleSource } from '#auklet/css/vite/cssModuleStyleSource';
import {
  toCssModuleStyleAssetBrowserUrl,
  toCssModuleStyleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import { generateScopedName } from '#auklet/css/modules/generateScopedName';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { normalizeFileKey } from '#auklet/utils';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';

const expectedScopedName = (localName: string, filename: string) => {
  const base = path.basename(filename).replace(/\.module\.(css|less)$/i, '');
  const hash = createHash('sha256')
    .update(`${normalizeFileKey(filename)}:${localName}`)
    .digest('base64url')
    .slice(0, 6);
  return `${base}_${localName}_${hash}`;
};

describe('css/modules protocol', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('detects CSS Modules file names', () => {
    expect(isCssModuleFile('Button.module.css')).toBe(true);
    expect(isCssModuleFile('Button.module.less')).toBe(true);
    expect(isCssModuleFile('module.css')).toBe(false);
    expect(isCssModuleFile('Button.css')).toBe(false);
  });

  test('reads the module entry once through the import graph', async () => {
    const file = project.writeFile('Button.module.css', '.button {}');
    const readSpy = vi.spyOn(fs, 'readFileSync');

    await compileCssModule({ file });

    const entryReads = readSpy.mock.calls.filter(
      ([readFile]) => path.resolve(String(readFile)) === file,
    );
    expect(entryReads).toHaveLength(1);
    readSpy.mockRestore();
  });

  test('compiles *.module.css with preserved local css partials', async () => {
    const partial = project.writeFile(
      'tokens.css',
      ':root { --button-color: tomato; }',
    );
    const file = project.writeFile(
      'Button.module.css',
      `
        @import "./tokens.css";
        .button { color: var(--button-color); }
      `,
    );

    const result = await compileCssModule({ file });
    const buttonClass = expectedScopedName('button', file);

    expect(result.locals.button).toBe(buttonClass);
    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.scopedCss).toContain(`.${buttonClass}`);
    expect(result.scopedCss).not.toContain('@import');
    expect(result.css).toContain(`.${buttonClass}`);
    expect(result.styleAssets).toEqual([
      {
        file: path.resolve(partial),
        css: ':root { --button-color: tomato; }',
        dependencies: [path.resolve(partial)],
      },
    ]);
    expect(result.watchFiles).toEqual(
      expect.arrayContaining([file, path.resolve(partial)]),
    );
  });

  test('compiles locals and hashed CSS for *.module.css', async () => {
    const file = project.writeFile(
      'Button.module.css',
      `
        .button { color: red; }
        :global(.theme) { color: blue; }
      `,
    );

    const result = await compileCssModule({ file });
    const buttonClass = expectedScopedName('button', file);

    expect(result.locals.button).toBe(buttonClass);
    expect(result.css).toContain(`.${buttonClass}`);
    expect(result.scopedCss).toBe(result.css);
    expect(result.css).toContain('.theme');
    expect(result.css).not.toContain(':global');
    expect(result.styleAssets).toEqual([]);
    expect(result.watchFiles).toEqual([file]);
    expect(generateScopedName('button', file, '')).toBe(buttonClass);
  });

  test('compiles *.module.less through Less then Modules', async () => {
    const partial = project.writeFile(
      'tokens.less',
      `
        @brand: tomato;
        :root { --brand: @brand; }
      `,
    );
    const file = project.writeFile(
      'Card.module.less',
      `
        @import "./tokens.less";
        .card { color: var(--brand); }
      `,
    );

    const result = await compileCssModule({ file });
    const cardClass = expectedScopedName('card', file);

    expect(result.locals.card).toBe(cardClass);
    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.scopedCss).toContain(`.${cardClass}`);
    expect(result.scopedCss).not.toContain('@import');
    expect(result.css).toContain(`.${cardClass}`);
    expect(result.css).toContain('color: var(--brand)');
    expect(result.styleAssets).toEqual([
      {
        file: path.resolve(partial),
        css: expect.stringContaining('--brand: tomato'),
        dependencies: [path.resolve(partial)],
      },
    ]);
    expect(result.watchFiles).toEqual(
      expect.arrayContaining([file, path.resolve(partial)]),
    );
  });

  test('rejects non-Modules files', async () => {
    const file = project.writeFile('global.css', '.ok {}');

    await expect(compileCssModule({ file })).rejects.toThrow(
      'expected a CSS Modules file',
    );
  });

  test('rejects missing Modules files without inline code', async () => {
    const file = project.resolve('Missing.module.css');

    await expect(compileCssModule({ file })).rejects.toThrow(
      'CSS Modules file not found',
    );
  });

  test('rejects missing local CSS Modules partial imports', async () => {
    const file = project.writeFile(
      'Button.module.css',
      '@import "./missing.css";\n.button {}',
    );

    await expect(compileCssModule({ file })).rejects.toThrow(
      '[css] local CSS import not found: ./missing.css from',
    );
  });

  test('rejects alias-like CSS Modules partial imports', async () => {
    const file = project.writeFile(
      'Button.module.css',
      '@import "#styles/tokens.css";\n.button {}',
    );

    await expect(compileCssModule({ file })).rejects.toThrow(
      '[css] CSS Modules partial imports must be relative paths:',
    );
  });

  test('rejects CSS Modules partial imports outside source root', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('outside.css', '.outside {}');
    const file = project.writeFile(
      'src/Button.module.css',
      '@import "../outside.css";\n.button {}',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      '[css] local CSS import escapes source root:',
    );
  });

  test('rejects nested Less partial imports outside source root', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('outside.less', '@outside: red;');
    project.writeFile('src/tokens.less', '@import "../outside.less";');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: @outside; }',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      '[css] local CSS import escapes source root:',
    );
  });

  test('rejects Less imports nested under CSS partials', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/theme.css',
      '@import "./variables.less";\n.theme {}',
    );
    project.writeFile('src/variables.less', '@theme-color: teal;');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./theme.css";\n.tag {}',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      `[css] CSS Modules partial imports must be local .css files: ./variables.less from ${project.resolve('src/theme.css')}`,
    );
  });

  test('rejects conditional @import in CSS Modules partials', async () => {
    const sourceRoot = project.resolve('src');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less" layer(base);\n.tag {}',
    );
    project.writeFile('src/tokens.less', '@tag-color: teal;');

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      'CSS Modules partial imports do not support conditional @import',
    );
  });

  test('accepts unquoted url() Less @import in CSS Modules', async () => {
    project.writeFile('src/tokens.less', '@tag-color: teal;');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import url(./tokens.less);\n.tag { color: @tag-color; }',
    );

    const result = await compileCssModule({
      file,
      sourceRoot: project.resolve('src'),
    });

    expect(result.locals.tag).toBeTruthy();
    expect(result.watchFiles).toContain(project.resolve('src/tokens.less'));
  });

  test('rejects Less imports that bypass parseLessSourceImports via url() syntax', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('outside.less', '@outside: red;');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import url(../outside.less);\n.tag { color: @outside; }',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      '[css] local CSS import escapes source root:',
    );
  });

  test('rejects circular CSS Modules partial imports', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('src/a.css', '@import "./b.css";');
    project.writeFile('src/b.css', '@import "./a.css";');
    const file = project.writeFile(
      'src/Button.module.css',
      '@import "./a.css";\n.button {}',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      '[css] circular CSS import detected:',
    );
  });

  test('rejects circular Less partial imports in CSS Modules', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('src/a.less', '@import "./b.less";');
    project.writeFile('src/b.less', '@import "./a.less";');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./a.less";\n.tag {}',
    );

    await expect(compileCssModule({ file, sourceRoot })).rejects.toThrow(
      '[css] circular CSS import detected:',
    );
  });

  test('compileCssModule accepts inline entry code without reading the entry file', async () => {
    const file = project.resolve('src/Button.module.css');
    project.writeFile('src/tokens.css', ':root { --button-color: tomato; }');

    const result = await compileCssModule({
      file,
      code: '@import "./tokens.css";\n.button { color: var(--button-color); }',
      sourceRoot: project.resolve('src'),
    });

    expect(result.locals.button).toBeTruthy();
    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.styleAssets).toEqual([
      {
        file: project.resolve('src/tokens.css'),
        css: ':root { --button-color: tomato; }',
        dependencies: [project.resolve('src/tokens.css')],
      },
    ]);
  });

  test('creates virtual CSS sources with preserved partial imports', async () => {
    const partial = project.writeFile(
      'src/tokens.css',
      ':root { --tag-color: teal; }',
    );
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.css";\n.tag { color: var(--tag-color); }',
    );
    const result = await compileCssModule({ file });
    const styleSource = createCssModuleDevStyleSource(file, result);
    const assetSource = createCssModuleDevStyleSource(file, result, partial);

    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.styleAssets).toEqual([
      {
        file: project.resolve('src/tokens.css'),
        css: ':root { --tag-color: teal; }',
        dependencies: [project.resolve('src/tokens.css')],
      },
    ]);
    expect(styleSource).toContain(
      `@import "${toCssModuleStyleAssetBrowserUrl(file, partial)}"`,
    );
    expect(styleSource).not.toContain('--tag-color: teal');
    expect(assetSource).toContain('--tag-color: teal');
    expect(assetSource).not.toContain('@import');
  });

  test('preserves Less reference import semantics', async () => {
    project.writeFile(
      'src/tokens.less',
      '.unused { color: red; }\n.tag-color() { color: teal; }',
    );
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import (reference) "./tokens.less";\n.tag { .tag-color(); }',
    );

    const result = await compileCssModule({ file });

    expect(result.css).toContain('color: teal');
    expect(result.css).not.toContain('.unused');
    expect(result.css).not.toContain('@import');
    expect(result.styleAssets).toEqual([]);
  });

  test('preserves Less inline import semantics for CSS files', async () => {
    project.writeFile('src/tokens.css', ':root { --tag-color: teal; }');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import (inline) "./tokens.css";\n.tag { color: var(--tag-color); }',
    );

    const result = await compileCssModule({ file });

    expect(result.css).toContain('--tag-color: teal');
    expect(result.css).not.toContain('@import');
    expect(result.styleAssets).toEqual([]);
  });

  test('preserves Less css import semantics for Less files', async () => {
    project.writeFile('src/tokens.less', ':root { --tag-color: teal; }');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import (css) "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const result = await compileCssModule({ file });

    expect(result.css).toContain('@import "./tokens.css"');
    expect(result.styleAssets).toEqual([
      {
        file: project.resolve('src/tokens.less'),
        css: ':root { --tag-color: teal; }',
        dependencies: [project.resolve('src/tokens.less')],
      },
    ]);
  });

  test('preserves Less less import semantics for CSS files', async () => {
    project.writeFile('src/tokens.css', '@tag-color: teal;');
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import (less) "./tokens.css";\n.tag { color: @tag-color; }',
    );

    const result = await compileCssModule({ file });

    expect(result.css).toContain('color: teal');
    expect(result.css).not.toContain('@import');
    expect(result.styleAssets).toEqual([]);
  });

  test('preserves Less optional import semantics for missing files', async () => {
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import (optional) "./missing.less";\n.tag { color: teal; }',
    );

    const result = await compileCssModule({
      file,
      sourceRoot: project.resolve('src'),
    });

    expect(result.css).toContain('color: teal');
    expect(result.css).not.toContain('@import');
    expect(result.styleAssets).toEqual([]);
  });

  test.each([
    ['once', 1],
    ['multiple', 2],
  ] as const)(
    'delegates Less %s import semantics to Less',
    async (option, expectedCount) => {
      project.writeFile('src/tokens.less', '.token { color: teal; }');
      const file = project.writeFile(
        'src/Tag.module.less',
        [
          `@import (${option}) "./tokens.less";`,
          `@import (${option}) "./tokens.less";`,
          '.tag {}',
        ].join('\n'),
      );

      const result = await compileCssModule({ file });
      const tokenClass = expectedScopedName('token', file);

      expect(
        result.css.match(new RegExp(`\\.${tokenClass}\\b`, 'g')),
      ).toHaveLength(expectedCount);
      expect(result.styleAssets).toEqual([]);
    },
  );

  test('compileCssModule collects nested CSS dependencies from Less partials', async () => {
    project.writeFile('src/base.css', ':root { --tag-color: teal; }');
    project.writeFile(
      'src/theme.less',
      '@import "./base.css";\n.theme { color: var(--tag-color); }',
    );
    project.writeFile(
      'src/tokens.less',
      '@import "./theme.less";\n.tokens { color: var(--tag-color); }',
    );
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );

    const result = await compileCssModule({
      file,
      sourceRoot: project.resolve('src'),
    });

    expect(result.styleAssets).toEqual([
      {
        file: project.resolve('src/base.css'),
        css: ':root { --tag-color: teal; }',
        dependencies: [project.resolve('src/base.css')],
      },
      {
        file: project.resolve('src/tokens.less'),
        css: expect.stringContaining('@import "base.css"'),
        dependencies: [
          project.resolve('src/tokens.less'),
          project.resolve('src/theme.less'),
          project.resolve('src/base.css'),
        ],
      },
    ]);
    const tokensSource = createCssModuleDevStyleSource(
      file,
      result,
      project.resolve('src/tokens.less'),
    );
    expect(tokensSource).toContain(
      toCssModuleStyleAssetBrowserUrl(file, project.resolve('src/base.css')),
    );
    expect(tokensSource).toContain('.theme');
    expect(tokensSource).toContain('.tokens');
    expect(result.watchFiles).toEqual(
      expect.arrayContaining([
        file,
        project.resolve('src/tokens.less'),
        project.resolve('src/theme.less'),
        project.resolve('src/base.css'),
      ]),
    );
  });

  test('deduplicates CSS dependencies shared by multiple Less imports', async () => {
    project.writeFile('src/shared.css', ':root { --shared-color: teal; }');
    project.writeFile(
      'src/a.css',
      '@import "./shared.css";\n.a { color: var(--shared-color); }',
    );
    project.writeFile(
      'src/b.css',
      '@import "./shared.css";\n.b { color: var(--shared-color); }',
    );
    const file = project.writeFile(
      'src/Tag.module.less',
      '@import "./a.css";\n@import "./b.css";\n.tag {}',
    );

    const result = await compileCssModule({
      file,
      sourceRoot: project.resolve('src'),
    });

    expect(
      result.styleAssets.filter(
        (asset) => asset.file === project.resolve('src/shared.css'),
      ),
    ).toHaveLength(1);
  });

  test('dev style source keeps production imports without custom runtime', async () => {
    project.writeFile('tokens.less', ':root { --tag-color: teal; }');
    const file = project.writeFile(
      'Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const result = await compileCssModule({ file });
    const styleSource = createCssModuleDevStyleSource(file, result);

    expect(styleSource).toContain('color: var(--tag-color)');
    expect(styleSource).toContain(
      toCssModuleStyleAssetBrowserUrl(file, project.resolve('tokens.less')),
    );
    expect(styleSource).not.toContain('document.');
    expect(styleSource).not.toContain('import.meta.hot');
  });

  test('createCssModuleLocalsViteLoadCode exports locals and imports style shim', async () => {
    const file = project.writeFile('Button.module.css', '.button {}');
    const result = await compileCssModule({ file });
    const styleModuleId = toCssModuleStyleVirtualId(file);
    const loadCode = createCssModuleLocalsViteLoadCode(result, styleModuleId);

    expect(loadCode).toContain(`import ${JSON.stringify(styleModuleId)};`);
    expect(loadCode).toContain(
      `export default ${JSON.stringify(result.locals)}`,
    );
    expect(loadCode).not.toContain('import.meta.hot');
    expect(loadCode).not.toContain('data-auklet-css-modules');
  });
});
