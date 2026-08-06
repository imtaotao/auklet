import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as cssModuleCompile from '#auklet/css/modules/compileCssModule';
import {
  planCssModuleHotUpdate,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import {
  CssModuleDevCompileCache,
  CssModuleDevCompileCacheRegistry,
} from '#auklet/css/vite/hmr/cssModuleCompileCache';
import type { ModuleGraphLookup } from '#auklet/css/vite/hmr/propagate';
import { VirtualDependencyTracker } from '#auklet/css/vite/hmr/tracker';
import { aukletStylePlugin } from '#auklet/css/vite/vitePlugin';
import {
  createVirtualProject,
  type VirtualProject,
} from '../../fixtures/virtualProject';
import { loadCssModuleDevPair } from './helpers';

const createModuleGraph = (virtualIds: Array<string>): ModuleGraphLookup => {
  const modules = new Map(virtualIds.map((id) => [id, { id }]));
  return {
    getModuleById: (id: string) => modules.get(id) as never,
  };
};

describe('planCssModuleHotUpdate locals/style split', () => {
  let project: VirtualProject;
  let tracker: VirtualDependencyTracker;
  let compileCache: CssModuleDevCompileCache;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-hot-plan-');
    tracker = new VirtualDependencyTracker();
    compileCache = new CssModuleDevCompileCache();
  });

  afterEach(() => {
    project.cleanup();
  });

  const trackModule = (file: string, watchFiles: Array<string>) => {
    for (const virtualId of [
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]) {
      tracker.replaceDependencies(virtualId, watchFiles);
    }
  };

  test('style-only edits return only the style virtual module after locals are seeded', async () => {
    project.writeFile('src/Tag.module.css', '.tag { color: red; }');
    const file = project.resolve('src/Tag.module.css');
    trackModule(file, [file]);
    const moduleGraph = createModuleGraph([
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]);

    await compileCache.compile(file, { force: true });
    project.writeFile('src/Tag.module.css', '.tag { color: blue; }');

    const virtualIds = await planCssModuleHotUpdate({
      tracker,
      file,
      moduleGraph,
      compileCache,
      resolveSourceRoot: async () => null,
    });

    expect(virtualIds).toEqual([toCssModuleStyleVirtualId(file)]);
  });

  test('class rename returns locals and style virtual modules', async () => {
    project.writeFile('src/Tag.module.css', '.tag { color: red; }');
    const file = project.resolve('src/Tag.module.css');
    trackModule(file, [file]);
    const moduleGraph = createModuleGraph([
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]);

    await compileCache.compile(file, { force: true });
    project.writeFile('src/Tag.module.css', '.label { color: blue; }');

    const virtualIds = await planCssModuleHotUpdate({
      tracker,
      file,
      moduleGraph,
      compileCache,
      resolveSourceRoot: async () => null,
    }).then((ids) => ids.sort());

    expect(virtualIds).toEqual(
      [toCssModuleVirtualId(file), toCssModuleStyleVirtualId(file)].sort(),
    );
  });

  test('Less partial value edits with unchanged locals return only style', async () => {
    project.writeFile('src/tokens.less', ':root { --tag-color: red; }');
    const partial = project.resolve('src/tokens.less');
    project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const file = project.resolve('src/Tag.module.less');
    trackModule(file, [file, partial]);
    const moduleGraph = createModuleGraph([
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]);

    await compileCache.compile(file, { force: true });
    project.writeFile('src/tokens.less', ':root { --tag-color: blue; }');

    const virtualIds = await planCssModuleHotUpdate({
      tracker,
      file: partial,
      moduleGraph,
      compileCache,
      resolveSourceRoot: async () => project.resolve('src'),
    });

    expect(virtualIds).toEqual([toCssModuleStyleVirtualId(file)]);
  });

  test('partial hot update ignores context.read and reads module entry from disk', async () => {
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    project.writeFile('src/tokens.less', ':root { --tag-color: red; }');
    const partial = project.resolve('src/tokens.less');
    project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const file = project.resolve('src/Tag.module.less');
    trackModule(file, [file, partial]);
    const moduleGraph = createModuleGraph([
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]);

    await compileCache.compile(file, { force: true });
    project.writeFile('src/tokens.less', ':root { --tag-color: blue; }');

    const read = vi.fn(async () => '/* stale entry */ .tag { color: pink; }');
    await planCssModuleHotUpdate({
      tracker,
      file: partial,
      moduleGraph,
      compileCache,
      resolveSourceRoot: async () => project.resolve('src'),
      read,
    });

    expect(read).not.toHaveBeenCalled();
    expect(compileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        code: undefined,
      }),
    );
    compileSpy.mockRestore();
  });

  test('module entry hot update passes context.read to compileCssModule', async () => {
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    project.writeFile('src/Tag.module.css', '.tag { color: red; }');
    const file = project.resolve('src/Tag.module.css');
    trackModule(file, [file]);
    const moduleGraph = createModuleGraph([
      toCssModuleVirtualId(file),
      toCssModuleStyleVirtualId(file),
    ]);

    await compileCache.compile(file, { force: true });
    const read = vi.fn(async () => '.tag { color: green; }');
    await planCssModuleHotUpdate({
      tracker,
      file,
      moduleGraph,
      compileCache,
      resolveSourceRoot: async () => null,
      read,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        code: '.tag { color: green; }',
      }),
    );
    compileSpy.mockRestore();
  });
});

describe('CssModuleDevCompileCache', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-cache-');
  });

  afterEach(() => {
    project.cleanup();
  });

  test('reuses compileCssModule output for repeated loads until watch files change', async () => {
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const cache = new CssModuleDevCompileCache();

    await cache.compile(file, { force: true });
    await cache.compile(file);
    await cache.compile(file);

    expect(compileSpy).toHaveBeenCalledTimes(1);

    project.writeFile('src/Button.module.css', '.button { color: blue; }');
    await cache.compile(file, { force: true });

    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });

  test('deduplicates concurrent compile requests for the same module file', async () => {
    const compileSpy = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementation(async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          css: '.button { color: red; }',
          scopedCss: '.button { color: red; }',
          locals: { button: 'Button_button_abc' },
          watchFiles: [request.file],
          styleAssets: [],
        };
      });
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const cache = new CssModuleDevCompileCache();

    await Promise.all([cache.compile(file), cache.compile(file)]);

    expect(compileSpy).toHaveBeenCalledTimes(1);
    compileSpy.mockRestore();
  });

  test('force compile during a pending compile keeps the newer cache result', async () => {
    let releaseSlowCompile: () => void = () => {};
    const slowCompileGate = new Promise<void>((resolve) => {
      releaseSlowCompile = resolve;
    });
    const compileSpy = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementationOnce(async () => {
        await slowCompileGate;
        return {
          css: '.button { color: red; }',
          scopedCss: '.button { color: red; }',
          locals: { button: 'Button_button_old' },
          watchFiles: [],
          styleAssets: [],
        };
      })
      .mockImplementationOnce(async () => ({
        css: '.button { color: blue; }',
        scopedCss: '.button { color: blue; }',
        locals: { button: 'Button_button_new' },
        watchFiles: [],
        styleAssets: [],
      }));
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const cache = new CssModuleDevCompileCache();

    const pending = cache.compile(file);
    const forced = cache.compile(file, { force: true });
    const forcedResult = await forced;

    expect(forcedResult.locals).toEqual({ button: 'Button_button_new' });
    expect(cache.peekLocals(file)).toEqual({ button: 'Button_button_new' });

    releaseSlowCompile();
    const pendingResult = await pending;

    expect(pendingResult.locals).toEqual({ button: 'Button_button_new' });
    expect(cache.peekLocals(file)).toEqual({ button: 'Button_button_new' });
    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });

  test('invalidate during a pending compile returns a fresh result', async () => {
    let releaseSlowCompile: () => void = () => {};
    const slowCompileGate = new Promise<void>((resolve) => {
      releaseSlowCompile = resolve;
    });
    const compileSpy = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementationOnce(async () => {
        await slowCompileGate;
        return {
          css: '.button { color: red; }',
          scopedCss: '.button { color: red; }',
          locals: { button: 'Button_button_old' },
          watchFiles: [],
          styleAssets: [],
        };
      })
      .mockImplementationOnce(async () => ({
        css: '.button { color: blue; }',
        scopedCss: '.button { color: blue; }',
        locals: { button: 'Button_button_new' },
        watchFiles: [],
        styleAssets: [],
      }));
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const cache = new CssModuleDevCompileCache();

    const pending = cache.compile(file);
    cache.invalidateModuleFile(file);
    releaseSlowCompile();
    const pendingResult = await pending;

    expect(pendingResult.locals).toEqual({ button: 'Button_button_new' });
    expect(cache.peekLocals(file)).toEqual({ button: 'Button_button_new' });
    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });

  test('invalidate during a pending compile rejects when the module was deleted', async () => {
    let releaseSlowCompile: () => void = () => {};
    const slowCompileGate = new Promise<void>((resolve) => {
      releaseSlowCompile = resolve;
    });
    const compileSpy = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementationOnce(async () => {
        await slowCompileGate;
        return {
          css: '.button { color: red; }',
          scopedCss: '.button { color: red; }',
          locals: { button: 'Button_button_old' },
          watchFiles: [],
          styleAssets: [],
        };
      });
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const cache = new CssModuleDevCompileCache();

    const pending = cache.compile(file);
    fs.rmSync(file);
    cache.invalidateModuleFile(file);
    releaseSlowCompile();

    await expect(pending).rejects.toThrow(
      `[css] CSS Modules file not found: ${file}`,
    );
    expect(cache.peekLocals(file)).toBeNull();
    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });

  test('recompiles without force when a tracked watch file mtime changes', async () => {
    project.writeFile('src/tokens.less', ':root { --tag-color: red; }');
    project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const file = project.resolve('src/Tag.module.less');
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    const cache = new CssModuleDevCompileCache();

    await cache.compile(file, { force: true });
    project.writeFile('src/tokens.less', ':root { --tag-color: blue; }');
    await cache.compile(file);

    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });

  test('invalidateWatchFile clears cached locals until the module is loaded again', async () => {
    project.writeFile('src/tokens.less', ':root { --tag-color: red; }');
    const partial = project.resolve('src/tokens.less');
    project.writeFile(
      'src/Tag.module.less',
      '@import "./tokens.less";\n.tag { color: var(--tag-color); }',
    );
    const file = project.resolve('src/Tag.module.less');
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    const cache = new CssModuleDevCompileCache();

    await cache.compile(file, { force: true });
    expect(cache.peekLocals(file)).toBeTruthy();

    cache.invalidateWatchFile(partial);
    expect(cache.peekLocals(file)).toBeNull();

    await cache.compile(file, { force: true });
    expect(compileSpy).toHaveBeenCalledTimes(2);
    expect(cache.peekLocals(file)).toBeTruthy();
    compileSpy.mockRestore();
  });
});

describe('CssModuleDevCompileCacheRegistry', () => {
  test('keeps locals snapshots isolated per Vite environment', async () => {
    const registry = new CssModuleDevCompileCacheRegistry();
    const clientCache = registry.forEnvironment('client');
    const ssrCache = registry.forEnvironment('ssr');
    const compileSpy = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementationOnce(async () => ({
        css: '.tag { color: red; }',
        scopedCss: '.tag { color: red; }',
        locals: { tag: 'Tag_tag_old' },
        watchFiles: [],
        styleAssets: [],
      }))
      .mockImplementationOnce(async () => ({
        css: '.tag { color: red; }',
        scopedCss: '.tag { color: red; }',
        locals: { tag: 'Tag_tag_old' },
        watchFiles: [],
        styleAssets: [],
      }))
      .mockImplementationOnce(async () => ({
        css: '.label { color: blue; }',
        scopedCss: '.label { color: blue; }',
        locals: { label: 'Tag_label_new' },
        watchFiles: [],
        styleAssets: [],
      }))
      .mockImplementationOnce(async () => ({
        css: '.label { color: blue; }',
        scopedCss: '.label { color: blue; }',
        locals: { label: 'Tag_label_new' },
        watchFiles: [],
        styleAssets: [],
      }));

    const file = '/tmp/Tag.module.css';
    await clientCache.compile(file, { force: true });
    await ssrCache.compile(file, { force: true });

    expect(clientCache.peekLocals(file)).toEqual({ tag: 'Tag_tag_old' });
    expect(ssrCache.peekLocals(file)).toEqual({ tag: 'Tag_tag_old' });

    await clientCache.compile(file, { force: true });

    expect(clientCache.peekLocals(file)).toEqual({ label: 'Tag_label_new' });
    expect(ssrCache.peekLocals(file)).toEqual({ tag: 'Tag_tag_old' });

    const ssrVirtualIds = await planCssModuleHotUpdate({
      tracker: new VirtualDependencyTracker(),
      file,
      moduleGraph: createModuleGraph([
        toCssModuleVirtualId(file),
        toCssModuleStyleVirtualId(file),
      ]),
      compileCache: ssrCache,
      resolveSourceRoot: async () => null,
    }).then((ids) => ids.sort());

    expect(ssrVirtualIds).toEqual(
      [toCssModuleVirtualId(file), toCssModuleStyleVirtualId(file)].sort(),
    );
    expect(compileSpy).toHaveBeenCalledTimes(4);
    compileSpy.mockRestore();
  });
});

describe('aukletStylePlugin CSS Modules dev cache', () => {
  let project: VirtualProject;

  beforeEach(() => {
    project = createVirtualProject('auklet-css-module-dev-cache-');
    project.writeJson('package.json', { name: '@scope/app' });
  });

  afterEach(() => {
    project.cleanup();
    vi.restoreAllMocks();
  });

  test('loads locals and style virtual modules with a single compileCssModule call', async () => {
    const compileSpy = vi.spyOn(cssModuleCompile, 'compileCssModule');
    project.writeFile('src/Button.module.css', '.button { color: red; }');
    const file = project.resolve('src/Button.module.css');
    const plugin = aukletStylePlugin({ root: project.root });

    await loadCssModuleDevPair(plugin, { addWatchFile: vi.fn() }, file);

    expect(compileSpy).toHaveBeenCalledTimes(1);
    compileSpy.mockRestore();
  });
});
