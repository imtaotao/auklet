import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { HotUpdateOptions, ViteDevServer } from 'vite';
import * as cssModuleCompile from '#auklet/css/modules/compileCssModule';
import type {
  CssModuleRequest,
  CssModuleStyleAsset,
} from '#auklet/css/modules/compileCssModule';
import {
  toResolvedCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/hmr/cssModule';
import { AukletStyleHmr } from '#auklet/css/vite/hmr/styleHmr';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';

type MockModule = {
  id: string;
};

const fixture = {
  currentTime: 1000,
  moduleFile: '/workspace/packages/app/src/components/Tag/Tag.module.less',
  partialFile: '/workspace/packages/app/src/components/Tag/tokens.less',
  unrelatedFile: '/workspace/packages/app/README.md',
};

const getCssModuleVirtualIds = (file = fixture.moduleFile) => {
  const resolved = path.resolve(file);
  return [toCssModuleVirtualId(resolved), toCssModuleStyleVirtualId(resolved)];
};

const styleOnlyVirtualId = (file = fixture.moduleFile) =>
  toCssModuleStyleVirtualId(file);

const createCompileResult = (options: {
  file: string;
  css: string;
  locals: Record<string, string>;
  watchFiles?: Array<string>;
  styleAssets?: Array<CssModuleStyleAsset>;
}) => ({
  css: options.css,
  scopedCss: options.css,
  locals: options.locals,
  watchFiles: options.watchFiles ?? [options.file, fixture.partialFile],
  styleAssets: options.styleAssets ?? [],
});

const createGraph = () =>
  ({
    isStyleFile: vi.fn(() => false),
    resolveSourceRootForFile: vi.fn(async () => null),
  }) as unknown as ModuleStyleGraph;

const createServer = () => {
  const modules = new Map<string, MockModule>();
  const getModuleById = vi.fn((id: string) => modules.get(id));
  const invalidateModule = vi.fn();
  const reloadModule = vi.fn(async () => {});
  const send = vi.fn();
  const environmentModuleGraph = {
    getModuleById,
    invalidateModule,
  };

  return {
    modules,
    getModuleById,
    invalidateModule,
    reloadModule,
    send,
    server: {
      environments: {
        client: { moduleGraph: environmentModuleGraph },
        ssr: { moduleGraph: environmentModuleGraph },
      },
      moduleGraph: environmentModuleGraph,
      reloadModule,
      ws: { send },
    } as unknown as ViteDevServer,
  };
};

const registerModule = (
  context: ReturnType<typeof createServer>,
  virtualId: string,
) => {
  const module = { id: virtualId };
  context.modules.set(virtualId, module);
  return module;
};

const createContext = (
  server: ViteDevServer,
  file: string,
  timestamp = fixture.currentTime,
) =>
  ({
    file,
    type: 'update',
    modules: [],
    read: vi.fn(),
    server,
    timestamp,
  }) as unknown as HotUpdateOptions;

const trackCssModule = (
  hmr: AukletStyleHmr,
  context: ReturnType<typeof createServer>,
  files: Array<string> = [fixture.moduleFile, fixture.partialFile],
  moduleFile = fixture.moduleFile,
) => {
  const virtualIds = getCssModuleVirtualIds(moduleFile);
  for (const virtualId of virtualIds) {
    registerModule(context, virtualId);
  }
  hmr.replaceCssModuleDependency(moduleFile, files);
  return { virtualIds, moduleFile };
};

const clientModuleGraph = (context: ReturnType<typeof createServer>) =>
  context.server.environments.client.moduleGraph;

const expectReturnedModules = (modules: unknown, virtualIds: Array<string>) => {
  expect(Array.isArray(modules)).toBe(true);
  expect(
    (modules as Array<{ id: string }>).map((item) => item.id).sort(),
  ).toEqual([...virtualIds].sort());
};

describe('AukletStyleHmr CSS Modules', () => {
  let graph: ModuleStyleGraph;
  let hmr: AukletStyleHmr;
  let context: ReturnType<typeof createServer>;
  let compileMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixture.currentTime);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    graph = createGraph();
    hmr = new AukletStyleHmr(() => graph, { pruneDelayMs: 250 });
    context = createServer();
    compileMock = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementation(async (request) =>
        createCompileResult({
          file: request.file,
          css: '.tag { color: red; }',
          locals: { tag: 'Tag_tag_abc' },
        }),
      );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('replaceCssModuleDependency tracks module and partial watch files', () => {
    hmr.replaceCssModuleDependency(fixture.moduleFile, [
      fixture.moduleFile,
      fixture.partialFile,
    ]);

    expect(hmr.hasTrackedCssModuleDependency(fixture.moduleFile)).toBe(true);
    expect(hmr.hasTrackedCssModuleDependency(fixture.partialFile)).toBe(true);
    expect(hmr.hasTrackedCssModuleDependency(fixture.unrelatedFile)).toBe(
      false,
    );
  });

  test('replaceCssModuleDependency replaces stale partial mappings', () => {
    const nextPartial = '/workspace/packages/app/src/components/Tag/theme.less';

    hmr.replaceCssModuleDependency(fixture.moduleFile, [
      fixture.moduleFile,
      fixture.partialFile,
    ]);
    hmr.replaceCssModuleDependency(fixture.moduleFile, [
      fixture.moduleFile,
      nextPartial,
    ]);

    expect(hmr.hasTrackedCssModuleDependency(fixture.partialFile)).toBe(false);
    expect(hmr.hasTrackedCssModuleDependency(nextPartial)).toBe(true);
  });

  test('replaceCssModuleDependency removes stale virtual asset mappings', () => {
    const assetVirtualId = toResolvedCssModuleStyleAssetVirtualId(
      fixture.moduleFile,
      fixture.partialFile,
    );
    registerModule(context, assetVirtualId);
    hmr.replaceCssModuleDependency(
      fixture.moduleFile,
      [fixture.moduleFile, fixture.partialFile],
      [
        {
          file: fixture.partialFile,
          dependencies: [fixture.partialFile],
        },
      ],
    );
    hmr.replaceCssModuleDependency(fixture.moduleFile, [fixture.moduleFile]);

    expect(hmr.hasTrackedCssModuleDependency(fixture.partialFile)).toBe(false);
  });

  test('handleCombinedHotUpdate returns both modules before locals are seeded', async () => {
    const tracked = trackCssModule(hmr, context);

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, tracked.virtualIds);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('handleCombinedHotUpdate returns only style when locals are unchanged', async () => {
    trackCssModule(hmr, context);
    await hmr.compileCssModuleForDev(fixture.moduleFile);
    compileMock.mockImplementation(async (request: CssModuleRequest) =>
      createCompileResult({
        file: request.file,
        css: '.tag { color: blue; }',
        locals: { tag: 'Tag_tag_abc' },
      }),
    );

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, [styleOnlyVirtualId()]);
  });

  test('handleCombinedHotUpdate returns locals and style when class map changes', async () => {
    const tracked = trackCssModule(hmr, context);
    await hmr.compileCssModuleForDev(fixture.moduleFile);
    compileMock.mockImplementation(async (request: CssModuleRequest) =>
      createCompileResult({
        file: request.file,
        css: '.label { color: blue; }',
        locals: { label: 'Tag_label_xyz' },
      }),
    );

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, tracked.virtualIds);
  });

  test('handleCombinedHotUpdate returns only style for tracked Less partials when locals stay stable', async () => {
    trackCssModule(hmr, context);
    await hmr.compileCssModuleForDev(fixture.moduleFile);
    compileMock.mockImplementation(async (request: CssModuleRequest) =>
      createCompileResult({
        file: request.file,
        css: '.tag { color: var(--tag-color); --tag-color: blue; }',
        locals: { tag: 'Tag_tag_abc' },
      }),
    );

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.partialFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, [styleOnlyVirtualId()]);
  });

  test('updates only virtual assets whose dependency subtree changed', async () => {
    const parentFile = '/workspace/packages/app/src/components/Tag/theme.css';
    const childFile = '/workspace/packages/app/src/components/Tag/base.css';
    const independentFile =
      '/workspace/packages/app/src/components/Tag/independent.css';
    const styleAssets = [
      {
        file: parentFile,
        css: ':root {}',
        dependencies: [parentFile, childFile],
      },
      { file: childFile, css: ':root {}', dependencies: [childFile] },
      {
        file: independentFile,
        css: ':root {}',
        dependencies: [independentFile],
      },
    ];
    const assetVirtualIds = styleAssets.map((asset) =>
      toResolvedCssModuleStyleAssetVirtualId(fixture.moduleFile, asset.file),
    );

    trackCssModule(hmr, context, [
      fixture.moduleFile,
      parentFile,
      childFile,
      independentFile,
    ]);
    for (const virtualId of assetVirtualIds) {
      registerModule(context, virtualId);
    }
    hmr.replaceCssModuleDependency(
      fixture.moduleFile,
      [fixture.moduleFile, parentFile, childFile, independentFile],
      styleAssets,
    );
    compileMock.mockImplementation(async (request: CssModuleRequest) =>
      createCompileResult({
        file: request.file,
        css: '.tag { color: blue; }',
        locals: { tag: 'Tag_tag_abc' },
        styleAssets,
      }),
    );
    await hmr.compileCssModuleForDev(fixture.moduleFile);

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, childFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, [
      styleOnlyVirtualId(),
      assetVirtualIds[0]!,
      assetVirtualIds[1]!,
    ]);
  });

  test('handleCombinedHotUpdate returns undefined when nothing is tracked', async () => {
    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expect(result).toBeUndefined();
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('handleCombinedHotUpdate returns module nodes on repeated updates', async () => {
    trackCssModule(hmr, context);
    await hmr.compileCssModuleForDev(fixture.moduleFile);

    await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expectReturnedModules(result, [styleOnlyVirtualId()]);
  });

  test('handleCombinedHotUpdate drops stale virtual ids when module graph no longer has them', async () => {
    hmr.replaceCssModuleDependency(fixture.moduleFile, [fixture.moduleFile]);

    expect(hmr.hasTrackedCssModuleDependency(fixture.moduleFile)).toBe(true);

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );

    expect(result).toBeUndefined();
    expect(hmr.hasTrackedCssModuleDependency(fixture.moduleFile)).toBe(false);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('handleCombinedHotUpdate suppresses full reload during the HMR window', async () => {
    trackCssModule(hmr, context);
    const sentPayloads: Array<unknown> = [];

    context.server.ws.send = ((payload: unknown) => {
      sentPayloads.push(payload);
    }) as ViteDevServer['ws']['send'];
    hmr.installFullReloadGuard(context.server);

    await hmr.handleCombinedHotUpdate(
      createContext(context.server, fixture.moduleFile),
      clientModuleGraph(context),
    );
    sentPayloads.length = 0;
    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(0);

    vi.setSystemTime(fixture.currentTime + 200);
    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toEqual({ type: 'full-reload' });
  });

  test('handleCombinedHotUpdate returns module nodes for shared Less partials on both trackers', async () => {
    const partialFile = fixture.partialFile;
    const moduleVirtualIds = getCssModuleVirtualIds();
    const packageVirtualId = '\0auklet-css:@scope/app/components/Chip.css';

    graph = {
      isStyleFile: vi.fn(
        (file: string) => file.endsWith('.css') || file.endsWith('.less'),
      ),
      resolveSourceRootForFile: vi.fn(async () => null),
      parsePackageStyleId: vi.fn((stylePath: string) => ({
        packageName: '@scope/app',
        stylePath,
      })),
      getPackageNames: vi.fn(() => ['@scope/app']),
      createPackageStyleCode: vi.fn(async (parsed: { stylePath: string }) => ({
        code: `${parsed.stylePath}#1`,
        watchFiles: [partialFile],
      })),
      peekPackageStyleCode: vi.fn(() => null),
      invalidatePackage: vi.fn(),
      invalidateFile: vi.fn(),
      invalidateFileLoadResults: vi.fn(),
      isSourceGraphFile: vi.fn(() => false),
    } as unknown as ModuleStyleGraph;
    hmr = new AukletStyleHmr(() => graph, { pruneDelayMs: 250 });
    compileMock = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementation(async (request) =>
        createCompileResult({
          file: request.file,
          css: '.tag { color: red; }',
          locals: { tag: 'Tag_tag_abc' },
        }),
      );

    for (const virtualId of moduleVirtualIds) {
      registerModule(context, virtualId);
    }
    registerModule(context, packageVirtualId);
    hmr.replaceCssModuleDependency(fixture.moduleFile, [
      fixture.moduleFile,
      partialFile,
    ]);
    hmr.trackVirtualStyleDependency(partialFile, packageVirtualId);
    await hmr.compileCssModuleForDev(fixture.moduleFile);

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, partialFile),
      clientModuleGraph(context),
    );

    expect(result?.map((item) => item.id).sort()).toEqual(
      [styleOnlyVirtualId(), packageVirtualId].sort(),
    );
    expect(context.send).not.toHaveBeenCalled();
  });

  test('handleCombinedHotUpdate returns module nodes on repeated merged updates', async () => {
    const partialFile = fixture.partialFile;
    const packageVirtualId = '\0auklet-css:@scope/app/components/Chip.css';

    graph = {
      isStyleFile: vi.fn(
        (file: string) => file.endsWith('.css') || file.endsWith('.less'),
      ),
      resolveSourceRootForFile: vi.fn(async () => null),
      parsePackageStyleId: vi.fn((stylePath: string) => ({
        packageName: '@scope/app',
        stylePath,
      })),
      getPackageNames: vi.fn(() => ['@scope/app']),
      createPackageStyleCode: vi.fn(async (parsed: { stylePath: string }) => ({
        code: `${parsed.stylePath}#1`,
        watchFiles: [partialFile],
      })),
      peekPackageStyleCode: vi.fn(() => null),
      invalidatePackage: vi.fn(),
      invalidateFile: vi.fn(),
      invalidateFileLoadResults: vi.fn(),
      isSourceGraphFile: vi.fn(() => false),
    } as unknown as ModuleStyleGraph;
    hmr = new AukletStyleHmr(() => graph, { pruneDelayMs: 250 });
    compileMock = vi
      .spyOn(cssModuleCompile, 'compileCssModule')
      .mockImplementation(async (request) =>
        createCompileResult({
          file: request.file,
          css: '.tag { color: red; }',
          locals: { tag: 'Tag_tag_abc' },
        }),
      );

    registerModule(context, toCssModuleVirtualId(fixture.moduleFile));
    registerModule(context, toCssModuleStyleVirtualId(fixture.moduleFile));
    registerModule(context, packageVirtualId);
    hmr.replaceCssModuleDependency(fixture.moduleFile, [
      fixture.moduleFile,
      partialFile,
    ]);
    hmr.trackVirtualStyleDependency(partialFile, packageVirtualId);
    await hmr.compileCssModuleForDev(fixture.moduleFile);

    await hmr.handleCombinedHotUpdate(
      createContext(context.server, partialFile),
      clientModuleGraph(context),
    );

    const result = await hmr.handleCombinedHotUpdate(
      createContext(context.server, partialFile, fixture.currentTime + 100),
      clientModuleGraph(context),
    );

    expect(result?.map((item) => item.id).sort()).toEqual(
      [styleOnlyVirtualId(), packageVirtualId].sort(),
    );
    expect(context.send).not.toHaveBeenCalled();
  });

  test('removeCssModuleGraphFile clears tracker mappings and invalidates virtual modules', () => {
    const { virtualIds } = trackCssModule(hmr, context);

    hmr.removeCssModuleGraphFile(context.server, fixture.partialFile);

    expect(hmr.hasTrackedCssModuleDependency(fixture.partialFile)).toBe(false);
    for (const virtualId of virtualIds) {
      expect(context.invalidateModule).toHaveBeenCalledWith(
        expect.objectContaining({ id: virtualId }),
      );
    }
  });

  test('module unlink clears root and asset dependency state', () => {
    const nestedPartial = '/workspace/packages/app/src/components/Tag/base.css';
    const assetVirtualId = toResolvedCssModuleStyleAssetVirtualId(
      fixture.moduleFile,
      fixture.partialFile,
    );
    const { virtualIds } = trackCssModule(hmr, context, [
      fixture.moduleFile,
      fixture.partialFile,
      nestedPartial,
    ]);
    registerModule(context, assetVirtualId);
    hmr.replaceCssModuleDependency(
      fixture.moduleFile,
      [fixture.moduleFile, fixture.partialFile, nestedPartial],
      [
        {
          file: fixture.partialFile,
          dependencies: [fixture.partialFile, nestedPartial],
        },
      ],
    );

    hmr.removeCssModuleGraphFile(
      context.server,
      fixture.moduleFile,
      fixture.moduleFile,
    );

    expect(hmr.hasTrackedCssModuleDependency(fixture.moduleFile)).toBe(false);
    expect(hmr.hasTrackedCssModuleDependency(fixture.partialFile)).toBe(false);
    expect(hmr.hasTrackedCssModuleDependency(nestedPartial)).toBe(false);
    for (const virtualId of [...virtualIds, assetVirtualId]) {
      expect(context.invalidateModule).toHaveBeenCalledWith(
        expect.objectContaining({ id: virtualId }),
      );
    }
    expect(
      (
        hmr as unknown as {
          cssModuleAssetDependencies: Map<string, unknown>;
        }
      ).cssModuleAssetDependencies.size,
    ).toBe(0);
  });
});
