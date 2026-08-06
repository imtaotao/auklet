import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createCssModulesPlugin } from '#auklet/build/cssModulesPlugin';
import * as cssModuleCompile from '#auklet/css/modules/compileCssModule';
import { normalizeFileKey } from '#auklet/utils';
import {
  createVirtualProject,
  type VirtualProject,
} from '../fixtures/virtualProject';

const expectedScopedName = (localName: string, filename: string) => {
  const base = path.basename(filename).replace(/\.module\.(css|less)$/i, '');
  const hash = createHash('sha256')
    .update(`${normalizeFileKey(filename)}:${localName}`)
    .digest('base64url')
    .slice(0, 6);
  return `${base}_${localName}_${hash}`;
};

describe('createCssModulesPlugin', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-modules-plugin-');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    project.cleanup();
  });

  test('rewrites *.module.css to a synthetic *.module.css.js id', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const importer = project.resolve('src/Button.tsx');
    const plugin = createCssModulesPlugin({ sourceRoot });

    const resolved = await plugin.resolveId.handler(
      './Button.module.css',
      importer,
    );

    expect(resolved).toBe(path.join(sourceRoot, 'Button.module.css.js'));
    expect(String(resolved).endsWith('.css.js')).toBe(true);
    expect(String(resolved).endsWith('.css')).toBe(false);
  });

  test('load emits CSS asset beside the module js output path', async () => {
    const sourceRoot = project.resolve('src');
    const file = project.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: red; }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const emitted: Array<{ fileName: string; source: string }> = [];
    const entryId = path.join(
      sourceRoot,
      'components/Button/Button.module.css.js',
    );

    const loaded = await plugin.load.call(
      {
        emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
          emitted.push(asset);
        },
      },
      entryId,
    );

    expect(loaded?.code).toBe(
      `export default ${JSON.stringify({ button: expectedScopedName('button', file) })};\n`,
    );
    expect(loaded?.moduleSideEffects).toBe(true);

    const rendered = plugin.renderChunk(loaded!.code!, {
      fileName: 'components/Button/Button.module.css.js',
      moduleIds: [entryId],
    });

    expect(rendered?.code).toBe(
      `import "./Button.module.css";\n${loaded!.code}`,
    );

    const renderedCjs = plugin.renderChunk(
      `exports.default = ${JSON.stringify({ button: expectedScopedName('button', file) })};\n`,
      {
        fileName: 'components/Button/Button.module.css.js',
        moduleIds: [entryId],
      },
      { format: 'cjs' },
    );

    expect(renderedCjs?.code).toBe(
      `require("./Button.module.css");\nexports.default = ${JSON.stringify({ button: expectedScopedName('button', file) })};\n`,
    );

    expect(emitted).toEqual([
      {
        type: 'asset',
        fileName: 'components/Button/Button.module.css',
        source: expect.stringContaining(
          `.${expectedScopedName('button', file)}`,
        ),
      },
    ]);
  });

  test('production preserves reference and inline semantics without partial assets', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Tag/reference.less',
      '.reference-only { color: red; }\n.reference-mixin() { border-color: teal; }',
    );
    project.writeFile(
      'src/components/Tag/inline.css',
      '.inline-only { color: blue; }',
    );
    project.writeFile(
      'src/components/Tag/Tag.module.less',
      [
        '@import (reference) "./reference.less";',
        '@import (inline) "./inline.css";',
        '.tag { .reference-mixin(); }',
      ].join('\n'),
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const emitted: Array<{ fileName: string; source: string }> = [];
    const entryId = path.join(sourceRoot, 'components/Tag/Tag.module.less.js');

    await plugin.load.call(
      {
        emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
          emitted.push(asset);
        },
      },
      entryId,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe('components/Tag/Tag.module.css');
    expect(emitted[0]?.source).toContain('border-color: teal');
    expect(emitted[0]?.source).toContain('color: blue');
    expect(emitted[0]?.source).not.toContain('reference-only');
    expect(emitted[0]?.source).not.toContain('@import');
  });

  test('generateBundle emits css partial assets for *.module.css local imports', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Button/tokens.css',
      ':root { --button-color: tomato; }',
    );
    const file = project.writeFile(
      'src/components/Button/Button.module.css',
      '@import "./tokens.css";\n.button { color: var(--button-color); }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const entryId = path.join(
      sourceRoot,
      'components/Button/Button.module.css.js',
    );
    const emitted: Array<{ fileName: string; source: string }> = [];
    const emitContext = {
      emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
        emitted.push(asset);
      },
    };

    await plugin.load.call(emitContext, entryId);

    expect(emitted).toEqual([
      {
        type: 'asset',
        fileName: 'components/Button/tokens.css',
        source: ':root { --button-color: tomato; }',
      },
      {
        type: 'asset',
        fileName: 'components/Button/Button.module.css',
        source: expect.stringContaining(
          `.${expectedScopedName('button', file)}`,
        ),
      },
    ]);
  });

  test('generateBundle emits Less partial assets after buildStart when load is cached', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Tag/tokens.less',
      ':root { --tag-color: teal; }',
    );
    const file = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const entryId = path.join(sourceRoot, 'components/Tag/Tag.module.less.js');
    const emitted: Array<{ fileName: string; source: string }> = [];
    const emitContext = {
      emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
        emitted.push(asset);
      },
    };

    await plugin.load.call(emitContext, entryId);
    expect(emitted).toHaveLength(2);
    emitted.length = 0;
    plugin.buildStart();

    plugin.generateBundle.call(
      emitContext,
      {},
      {
        'Tag.module.less.js': {
          type: 'chunk',
          moduleIds: [entryId],
        },
      },
    );

    expect(emitted).toEqual([
      {
        type: 'asset',
        fileName: 'components/Tag/tokens.css',
        source: expect.stringContaining('--tag-color: teal'),
      },
      {
        type: 'asset',
        fileName: 'components/Tag/Tag.module.css',
        source: expect.stringContaining(`.${expectedScopedName('tag', file)}`),
      },
    ]);
    expect(emitted[1]?.source).toContain('@import "./tokens.css"');
  });

  test('preserves cross-directory imports in emitted Less partial assets', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile(
      'src/components/Tag/shared/base.css',
      ':root { --tag-color: teal; }',
    );
    project.writeFile(
      'src/components/Tag/partials/tokens.less',
      '@import "../shared/base.css";\n.tokens { color: var(--tag-color); }',
    );
    const file = project.writeFile(
      'src/components/Tag/Tag.module.less',
      '@import "./partials/tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const entryId = path.join(sourceRoot, 'components/Tag/Tag.module.less.js');
    const emitted: Array<{ fileName: string; source: string }> = [];
    const emitContext = {
      emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
        emitted.push(asset);
      },
    };

    await plugin.load.call(emitContext, entryId);

    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'components/Tag/shared/base.css',
          source: expect.stringContaining('--tag-color: teal'),
        }),
        expect.objectContaining({
          fileName: 'components/Tag/partials/tokens.css',
          source: expect.stringContaining('@import "../shared/base.css"'),
        }),
        expect.objectContaining({
          fileName: 'components/Tag/Tag.module.css',
          source: expect.stringContaining(
            `.${expectedScopedName('tag', file)}`,
          ),
        }),
      ]),
    );
    const moduleAsset = emitted.find(
      (asset) => asset.fileName === 'components/Tag/Tag.module.css',
    );
    expect(moduleAsset?.source).toContain('@import "./partials/tokens.css"');
  });

  test('does not resolve alias or bare CSS Modules imports', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('src/Button.module.css', '.button {}');
    const plugin = createCssModulesPlugin({ sourceRoot });
    const importer = project.resolve('src/Button.tsx');

    await expect(
      plugin.resolveId.handler('@alias/Button.module.css', importer),
    ).resolves.toBeNull();
    await expect(
      plugin.resolveId.handler('Button.module.css', importer),
    ).resolves.toBeNull();
  });

  test('load caches compileCssModule per file within one build', async () => {
    const sourceRoot = project.resolve('src');
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const plugin = createCssModulesPlugin({ sourceRoot });
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    const entryId = path.join(sourceRoot, 'Button.module.css.js');
    const emitContext = {
      emitFile(_asset: { type: 'asset'; fileName: string; source: string }) {},
    };

    await plugin.load.call(emitContext, entryId);
    await plugin.load.call(emitContext, entryId);

    expect(compileSpy).toHaveBeenCalledTimes(1);
  });

  test('buildStart clears compile cache so source edits are picked up', async () => {
    const sourceRoot = project.resolve('src');
    const file = project.writeFile(
      'src/Button.module.css',
      '.button { color: red; }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    const entryId = path.join(sourceRoot, 'Button.module.css.js');
    const emitted: Array<string> = [];
    const emitContext = {
      emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
        emitted.push(asset.source);
      },
    };

    await plugin.load.call(emitContext, entryId);
    plugin.buildStart();
    project.writeFile('src/Button.module.css', '.button { color: blue; }');

    await plugin.load.call(emitContext, entryId);

    expect(compileSpy).toHaveBeenCalledTimes(2);
    expect(emitted[0]).toContain('color: red');
    expect(emitted[1]).toContain('color: blue');
    expect(emitted[1]).toContain(expectedScopedName('button', file));
  });

  test('renderChunk resolves CSS output after buildStart when load is cached', async () => {
    const sourceRoot = project.resolve('src');
    const file = project.writeFile(
      'src/components/Button/Button.module.css',
      '.button { color: red; }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const entryId = path.join(
      sourceRoot,
      'components/Button/Button.module.css.js',
    );
    const emitContext = {
      emitFile(_asset: { type: 'asset'; fileName: string; source: string }) {},
    };

    await plugin.load.call(emitContext, entryId);
    plugin.buildStart();

    const renderedCjs = plugin.renderChunk(
      `exports.default = ${JSON.stringify({ button: expectedScopedName('button', file) })};\n`,
      {
        fileName: 'components/Button/Button.module.css.js',
        moduleIds: [entryId],
      },
      { format: 'cjs' },
    );

    expect(renderedCjs?.code).toBe(
      `require("./Button.module.css");\nexports.default = ${JSON.stringify({ button: expectedScopedName('button', file) })};\n`,
    );
  });

  test('emits basename CSS asset when module file is outside sourceRoot', async () => {
    const sourceRoot = project.resolve('src');
    const file = project.writeFile(
      'vendor/Widget.module.less',
      '.widget { color: red; }',
    );
    const plugin = createCssModulesPlugin({ sourceRoot });
    const entryId = await plugin.resolveId.handler(
      file,
      project.resolve('src/App.tsx'),
    );
    expect(entryId).toBe(
      path.join(path.dirname(file), 'Widget.module.less.js'),
    );

    const emitted: Array<{ fileName: string; source: string }> = [];

    await plugin.load.call(
      {
        emitFile(asset: { type: 'asset'; fileName: string; source: string }) {
          emitted.push(asset);
        },
      },
      String(entryId),
    );

    expect(emitted).toEqual([
      {
        type: 'asset',
        fileName: 'Widget.module.css',
        source: expect.stringContaining(
          `.${expectedScopedName('widget', file)}`,
        ),
      },
    ]);
  });
});
