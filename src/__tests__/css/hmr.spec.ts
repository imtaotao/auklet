import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AukletStyleHmr } from '#auklet/css/vite/hmr';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import type { HotUpdateOptions, ViteDevServer } from 'vite';

type MockModule = {
  id: string;
};

type HmrTestContext = ReturnType<typeof createHmrTestContext>;

const fixture = {
  currentTime: 1000,
  workspaceRoot: '/workspace',
  packageName: '@scope/package',
  componentName: 'Widget',
  styleFile: '/workspace/packages/package/src/components/Widget/index.css',
  sourceFile: '/workspace/packages/package/src/components/Widget/index.tsx',
  outsideFile: '/workspace/README.md',
};

const packageVirtualId = (entry: string) => {
  return `\0auklet-css:${fixture.packageName}/${entry}`;
};

const componentVirtualId = (name: string) => {
  return packageVirtualId(`components/${name}.css`);
};

const browserVirtualPath = (id: string) => {
  return `/@id/${id.replace('\0', '__x00__')}`;
};

const createModule = (id: string) => ({ id }) satisfies MockModule;

const registerModule = (context: HmrTestContext, id: string) => {
  const module = createModule(id);
  context.modules.set(id, module);
  return module;
};

const trackVirtualStyleDependency = (
  context: HmrTestContext,
  virtualId = componentVirtualId(fixture.componentName),
  file = fixture.styleFile,
) => {
  const module = registerModule(context, virtualId);
  context.hmr.trackVirtualStyleDependency(file, virtualId);
  return { id: virtualId, module };
};

const handleStyleUpdate = async (
  context: HmrTestContext,
  file = fixture.styleFile,
) => {
  return await context.hmr.handleStyleHotUpdate(
    createContext(context.server, file),
  );
};

const expectJsUpdates = (
  context: HmrTestContext,
  virtualIds: Array<string>,
) => {
  expect(context.send).toHaveBeenCalledWith({
    type: 'update',
    updates: virtualIds.map((id) => {
      const path = browserVirtualPath(id);
      return {
        type: 'js-update',
        path,
        acceptedPath: path,
        timestamp: fixture.currentTime,
        explicitImportRequired: false,
        isWithinCircularImport: false,
      };
    }),
  });
};

const createGraph = () => {
  let version = 0;
  const resultCache = new Map<
    string,
    { code: string; watchFiles: Array<string> }
  >();
  return {
    createPackageStyleCode: vi.fn(async (parsed: { stylePath: string }) => {
      const result = {
        code: `${parsed.stylePath}#${version}`,
        watchFiles: [fixture.styleFile],
      };
      resultCache.set(parsed.stylePath, result);
      return result;
    }),
    peekPackageStyleCode: vi.fn((parsed: { stylePath: string }) => {
      return resultCache.get(parsed.stylePath) ?? null;
    }),
    getPackageNames: vi.fn(() => [fixture.packageName]),
    isDebugEnabled: vi.fn(async () => false),
    invalidateFile: vi.fn(() => {
      version += 1;
      resultCache.clear();
      return fixture.packageName;
    }),
    parsePackageStyleId: vi.fn((stylePath: string) => {
      return {
        packageName: fixture.packageName,
        stylePath,
      };
    }),
    isSourceGraphFile: vi.fn((file: string) =>
      file.startsWith(`${fixture.workspaceRoot}/packages/`),
    ),
    isSourceModuleFile: vi.fn((file: string) => file.endsWith('.tsx')),
    isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
  } as unknown as ModuleStyleGraph;
};

const createServer = () => {
  const modules = new Map<string, MockModule>();
  const getModuleById = vi.fn((id: string) => modules.get(id));
  const invalidateModule = vi.fn();
  const send = vi.fn();

  return {
    modules,
    server: {
      moduleGraph: {
        getModuleById,
        invalidateModule,
      },
      ws: {
        send,
      },
    } as unknown as ViteDevServer,
    getModuleById,
    invalidateModule,
    send,
  };
};

const createContext = (server: ViteDevServer, file = fixture.styleFile) => {
  return {
    file,
    type: 'update',
    modules: [],
    read: vi.fn(),
    server,
    timestamp: fixture.currentTime,
  } as unknown as HotUpdateOptions;
};

const createHmrTestContext = (graph: ModuleStyleGraph) => {
  const server = createServer();
  const hmr = new AukletStyleHmr(() => graph, { pruneDelayMs: 250 });

  return {
    hmr,
    ...server,
  };
};

describe('AukletStyleHmr', () => {
  let graph: ModuleStyleGraph;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixture.currentTime);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    graph = createGraph();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('sends js updates for tracked virtual css dependencies', async () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(context);

    const result = await handleStyleUpdate(context);

    expect(result).toEqual([]);
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.styleFile);
    expect(context.invalidateModule).toHaveBeenCalledWith(
      trackedDependency.module,
    );
    expect(context.invalidateModule).toHaveBeenCalledTimes(1);
    expectJsUpdates(context, [trackedDependency.id]);
  });

  test('sends js updates for tracked virtual css dependencies even when output does not change', async () => {
    const stableResult = {
      code: 'style-v1',
      watchFiles: [fixture.styleFile],
    };
    const graph = {
      createPackageStyleCode: vi.fn(async () => stableResult),
      peekPackageStyleCode: vi.fn(() => stableResult),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      isDebugEnabled: vi.fn(async () => false),
      invalidateFile: vi.fn(() => fixture.packageName),
      parsePackageStyleId: vi.fn((stylePath: string) => {
        return {
          packageName: fixture.packageName,
          stylePath,
        };
      }),
      isSourceGraphFile: vi.fn((file: string) =>
        file.startsWith(`${fixture.workspaceRoot}/packages/`),
      ),
      isSourceModuleFile: vi.fn((file: string) => file.endsWith('.tsx')),
      isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
    } as unknown as ModuleStyleGraph;
    const context = createHmrTestContext(graph);
    trackVirtualStyleDependency(context);

    const result = await handleStyleUpdate(context);

    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.styleFile);
    expect(context.invalidateModule).toHaveBeenCalledWith({
      id: componentVirtualId(fixture.componentName),
    });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        {
          type: 'js-update',
          path: browserVirtualPath(componentVirtualId(fixture.componentName)),
          acceptedPath: browserVirtualPath(
            componentVirtualId(fixture.componentName),
          ),
          timestamp: fixture.currentTime,
          explicitImportRequired: false,
          isWithinCircularImport: false,
        },
      ],
    });
    expect(result).toEqual([]);
  });

  test('replaces stale tracked virtual dependencies for the same virtual module', () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(context);
    const nextStyleFile = `${fixture.workspaceRoot}/packages/package/src/components/Widget/extra.css`;

    context.hmr.replaceVirtualStyleDependency(trackedDependency.id, [
      nextStyleFile,
    ]);

    expect(
      context.hmr.hasTrackedStyleDependency(
        fixture.styleFile,
        context.server.moduleGraph,
      ),
    ).toBe(false);
    expect(
      context.hmr.hasTrackedStyleDependency(
        nextStyleFile,
        context.server.moduleGraph,
      ),
    ).toBe(true);
  });

  test('prunes stale virtual dependencies that no longer exist in the module graph', () => {
    const context = createHmrTestContext(graph);
    const packageStyleFile = `${fixture.workspaceRoot}/packages/package/src/style.css`;
    const firstDependency = trackVirtualStyleDependency(
      context,
      componentVirtualId(fixture.componentName),
    );
    const secondDependency = trackVirtualStyleDependency(
      context,
      packageVirtualId('style.css'),
      packageStyleFile,
    );

    registerModule(context, firstDependency.id);
    registerModule(context, secondDependency.id);
    context.modules.delete(firstDependency.id);

    context.hmr.pruneStaleVirtualDependencies(context.server.moduleGraph);

    expect(
      context.hmr.hasTrackedStyleDependency(
        fixture.styleFile,
        context.server.moduleGraph,
      ),
    ).toBe(false);
    expect(
      context.hmr.hasTrackedStyleDependency(
        packageStyleFile,
        context.server.moduleGraph,
      ),
    ).toBe(true);
  });

  test('throttles stale virtual dependency pruning across rapid changes', async () => {
    const context = createHmrTestContext(graph);
    const prune = vi.spyOn(context.hmr, 'pruneStaleVirtualDependencies');

    context.hmr.scheduleStaleVirtualDependencyPrune(context.server.moduleGraph);
    context.hmr.scheduleStaleVirtualDependencyPrune(context.server.moduleGraph);
    context.hmr.scheduleStaleVirtualDependencyPrune(context.server.moduleGraph);

    expect(prune).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);

    expect(prune).toHaveBeenCalledTimes(2);
  });

  test('cancels trailing stale virtual dependency pruning on close', async () => {
    const context = createHmrTestContext(graph);
    const prune = vi.spyOn(context.hmr, 'pruneStaleVirtualDependencies');

    context.hmr.scheduleStaleVirtualDependencyPrune(context.server.moduleGraph);
    context.hmr.scheduleStaleVirtualDependencyPrune(context.server.moduleGraph);
    context.hmr.cancelStaleVirtualDependencyPrune();

    await vi.advanceTimersByTimeAsync(3000);

    expect(prune).toHaveBeenCalledTimes(1);
  });

  test('ignores files outside the workspace style graph', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleStyleUpdate(context, fixture.outsideFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('ignores workspace source files that are not styles', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleStyleUpdate(context, fixture.sourceFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('sends js updates for tracked source module dependencies', async () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(
      context,
      componentVirtualId(fixture.componentName),
    );
    context.hmr.trackVirtualStyleDependency(
      fixture.sourceFile,
      trackedDependency.id,
    );

    const result = await context.hmr.handleSourceModuleChange(
      context.server,
      fixture.sourceFile,
    );

    expect(result).toBe(true);
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.sourceFile);
    expect(context.invalidateModule).toHaveBeenCalledWith(
      trackedDependency.module,
    );
    expectJsUpdates(context, [trackedDependency.id]);
  });

  test('sends updates when no settled snapshot exists for a tracked source module', async () => {
    const virtualId = componentVirtualId(fixture.componentName);
    const graph = {
      createPackageStyleCode: vi.fn(async () => ({
        code: 'style-v1',
        watchFiles: [fixture.styleFile],
      })),
      peekPackageStyleCode: vi.fn(() => null),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      isDebugEnabled: vi.fn(async () => false),
      invalidateFile: vi.fn(() => fixture.packageName),
      parsePackageStyleId: vi.fn((stylePath: string) => {
        return {
          packageName: fixture.packageName,
          stylePath,
        };
      }),
      isSourceGraphFile: vi.fn((file: string) =>
        file.startsWith(`${fixture.workspaceRoot}/packages/`),
      ),
      isSourceModuleFile: vi.fn((file: string) => file.endsWith('.tsx')),
      isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
    } as unknown as ModuleStyleGraph;
    const context = createHmrTestContext(graph);

    registerModule(context, virtualId);
    context.hmr.trackVirtualStyleDependency(fixture.sourceFile, virtualId);

    const result = await context.hmr.handleSourceModuleChange(
      context.server,
      fixture.sourceFile,
    );

    expect(result).toBe(true);
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: browserVirtualPath(virtualId),
          type: 'js-update',
        }),
      ],
    });
  });

  test('parses tracked resolved virtual ids before refreshing source module updates', async () => {
    const virtualId = componentVirtualId(fixture.componentName);
    let version = 0;
    const graph = {
      createPackageStyleCode: vi.fn(async () => ({
        code: `style-v${version}`,
        watchFiles: [fixture.styleFile],
      })),
      peekPackageStyleCode: vi.fn(() => null),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      isDebugEnabled: vi.fn(async () => false),
      invalidateFile: vi.fn(() => {
        version += 1;
        return fixture.packageName;
      }),
      parsePackageStyleId: vi.fn((stylePath: string) => {
        if (stylePath.startsWith('\0')) return null;
        if (
          stylePath !==
          `${fixture.packageName}/components/${fixture.componentName}.css`
        ) {
          return null;
        }
        return {
          packageName: fixture.packageName,
          stylePath: `components/${fixture.componentName}.css`,
        };
      }),
      isSourceGraphFile: vi.fn((file: string) =>
        file.startsWith(`${fixture.workspaceRoot}/packages/`),
      ),
      isSourceModuleFile: vi.fn((file: string) => file.endsWith('.tsx')),
      isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
    } as unknown as ModuleStyleGraph;
    const context = createHmrTestContext(graph);

    registerModule(context, virtualId);
    context.hmr.trackVirtualStyleDependency(fixture.sourceFile, virtualId);

    const result = await context.hmr.handleSourceModuleChange(
      context.server,
      fixture.sourceFile,
    );

    expect(result).toBe(true);
    expect(context.invalidateModule).toHaveBeenCalledWith({
      id: virtualId,
    });
    expect(context.send).toHaveBeenCalledWith({
      type: 'update',
      updates: [
        expect.objectContaining({
          path: browserVirtualPath(virtualId),
          type: 'js-update',
        }),
      ],
    });
    expect(graph.parsePackageStyleId).toHaveBeenCalledWith(
      `${fixture.packageName}/components/${fixture.componentName}.css`,
    );
  });

  test('skips source module css updates when the css output does not change', async () => {
    const virtualId = componentVirtualId(fixture.componentName);
    const loadedResult = {
      code: 'import "./index.css";',
      watchFiles: [fixture.sourceFile],
    };
    const resultCache = new Map<string, typeof loadedResult>();
    const graph = {
      createPackageStyleCode: vi.fn(async (parsed: { stylePath: string }) => {
        const cached = resultCache.get(parsed.stylePath);
        if (cached) {
          return cached;
        }
        const result = loadedResult;
        resultCache.set(parsed.stylePath, result);
        return result;
      }),
      peekPackageStyleCode: vi.fn((parsed: { stylePath: string }) => {
        return resultCache.get(parsed.stylePath) ?? null;
      }),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      isDebugEnabled: vi.fn(async () => false),
      invalidateFile: vi.fn(() => {
        resultCache.clear();
        return fixture.packageName;
      }),
      parsePackageStyleId: vi.fn((stylePath: string) => ({
        packageName: fixture.packageName,
        stylePath,
      })),
      isSourceGraphFile: vi.fn((file: string) =>
        file.startsWith(`${fixture.workspaceRoot}/packages/`),
      ),
      isSourceModuleFile: vi.fn((file: string) => file.endsWith('.tsx')),
      isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
    } as unknown as ModuleStyleGraph;
    const context = createHmrTestContext(graph);

    context.hmr.trackVirtualStyleDependency(fixture.sourceFile, virtualId);
    await graph.createPackageStyleCode({
      packageName: fixture.packageName,
      stylePath: 'components/Widget.css',
    });

    const result = await context.hmr.handleSourceModuleChange(
      context.server,
      fixture.sourceFile,
    );

    expect(result).toBe(false);
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.sourceFile);
  });

  test('invalidates source module cache even when tracked css generation fails', async () => {
    const virtualId = componentVirtualId(fixture.componentName);
    const graph = {
      createPackageStyleCode: vi
        .fn()
        .mockRejectedValueOnce(new Error('failed to build source module css'))
        .mockResolvedValue({
          code: 'style-v1',
          watchFiles: [fixture.styleFile],
        }),
      peekPackageStyleCode: vi.fn(() => null),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      isDebugEnabled: vi.fn(async () => false),
      invalidateFile: vi.fn(() => fixture.packageName),
      parsePackageStyleId: vi.fn((stylePath: string) => {
        if (
          stylePath !==
          `${fixture.packageName}/components/${fixture.componentName}.css`
        ) {
          return null;
        }
        return {
          packageName: fixture.packageName,
          stylePath: `components/${fixture.componentName}.css`,
        };
      }),
      isSourceGraphFile: vi.fn(() => true),
      isSourceModuleFile: vi.fn(() => true),
      isStyleFile: vi.fn(() => false),
    } as unknown as ModuleStyleGraph;
    const context = createHmrTestContext(graph);

    registerModule(context, virtualId);
    context.hmr.trackVirtualStyleDependency(fixture.sourceFile, virtualId);

    await expect(
      context.hmr.handleSourceModuleChange(context.server, fixture.sourceFile),
    ).rejects.toThrow('failed to build source module css');
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.sourceFile);
  });

  test('ignores duplicate updates in a short time window', async () => {
    const context = createHmrTestContext(graph);

    trackVirtualStyleDependency(context);
    await handleStyleUpdate(context);
    context.send.mockClear();
    vi.mocked(graph.invalidateFile).mockClear();

    const result = await handleStyleUpdate(context);

    expect(result).toEqual([]);
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.styleFile);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not send updates when no virtual dependency is tracked', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleStyleUpdate(context);

    expect(result).toBeUndefined();
    expect(graph.invalidateFile).toHaveBeenCalledWith(fixture.styleFile);
    expect(context.invalidateModule).not.toHaveBeenCalled();
    expect(context.send).not.toHaveBeenCalled();
  });

  test('suppresses full reload during the package CSS HMR window', async () => {
    const context = createHmrTestContext(graph);
    const sentPayloads: Array<unknown> = [];

    context.server.ws.send = ((payload: unknown) => {
      sentPayloads.push(payload);
    }) as ViteDevServer['ws']['send'];
    context.hmr.installFullReloadGuard(context.server);
    (
      context.hmr as unknown as { suppressFullReloadUntil: number }
    ).suppressFullReloadUntil = Date.now() + 100;
    sentPayloads.length = 0;

    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(0);

    vi.setSystemTime(fixture.currentTime + 200);
    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toEqual({ type: 'full-reload' });
  });
});
