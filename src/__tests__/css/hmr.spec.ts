import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AukletStyleHmr } from '#auklet/css/vite/hmr/styleHmr';
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
  lessFile: '/workspace/packages/package/src/components/Widget/index.less',
  packageJsonFile: '/workspace/packages/package/package.json',
  sourceFile: '/workspace/packages/package/src/components/Widget/index.tsx',
  outsideFile: '/workspace/README.md',
};

const packageVirtualId = (entry: string) => {
  return `\0auklet-css:${fixture.packageName}/${entry}`;
};

const componentVirtualId = (name: string) => {
  return packageVirtualId(`components/${name}.css`);
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

const handleCombinedUpdate = async (
  context: HmrTestContext,
  file = fixture.styleFile,
) => {
  return await context.hmr.handleCombinedHotUpdate(
    createContext(context.server, file),
    context.server.environments.client.moduleGraph,
  );
};

const expectReturnedModules = (modules: unknown, virtualIds: Array<string>) => {
  expect(Array.isArray(modules)).toBe(true);
  expect((modules as Array<{ id: string }>).map((item) => item.id)).toEqual(
    virtualIds,
  );
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
    invalidateFile: vi.fn(() => {
      version += 1;
      resultCache.clear();
      return fixture.packageName;
    }),
    invalidateFileLoadResults: vi.fn(() => {
      version += 1;
      resultCache.clear();
      return fixture.packageName;
    }),
    invalidatePackage: vi.fn(() => {
      version += 1;
      resultCache.clear();
    }),
    invalidateDependencyFile: vi.fn(() => {
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
    isStyleFile: vi.fn(
      (file: string) => file.endsWith('.css') || file.endsWith('.less'),
    ),
    isPackageManifestFile: vi.fn((file: string) =>
      file.endsWith('/package.json'),
    ),
  } as unknown as ModuleStyleGraph;
};

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
  const clientEnvironment = {
    moduleGraph: environmentModuleGraph,
    reloadModule,
  };

  return {
    modules,
    server: {
      environments: {
        client: clientEnvironment,
        ssr: { moduleGraph: environmentModuleGraph },
      },
      moduleGraph: environmentModuleGraph,
      reloadModule,
      ws: {
        send,
      },
    } as unknown as ViteDevServer,
    getModuleById,
    invalidateModule,
    reloadModule,
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

  test('returns module nodes for tracked virtual css dependencies', async () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(context);

    const result = await handleCombinedUpdate(context);

    expect(graph.invalidateDependencyFile).toHaveBeenCalledWith(
      fixture.styleFile,
    );
    expect(graph.invalidatePackage).not.toHaveBeenCalled();
    expectReturnedModules(result, [trackedDependency.id]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('returns module nodes for tracked virtual Less dependencies', async () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(
      context,
      componentVirtualId(fixture.componentName),
      fixture.lessFile,
    );

    const result = await handleCombinedUpdate(context, fixture.lessFile);

    expect(graph.isStyleFile).toHaveBeenCalledWith(fixture.lessFile);
    expect(graph.invalidateDependencyFile).toHaveBeenCalledWith(
      fixture.lessFile,
    );
    expectReturnedModules(result, [trackedDependency.id]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('invalidates tracked package manifests without rebuilding package contexts', async () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualStyleDependency(
      context,
      componentVirtualId(fixture.componentName),
      fixture.packageJsonFile,
    );

    const result = await handleCombinedUpdate(context, fixture.packageJsonFile);

    expect(graph.invalidateDependencyFile).toHaveBeenCalledWith(
      fixture.packageJsonFile,
    );
    expect(graph.invalidatePackage).not.toHaveBeenCalled();
    expectReturnedModules(result, [trackedDependency.id]);
  });

  test('returns module nodes for tracked virtual css dependencies even when output does not change', async () => {
    const stableResult = {
      code: 'style-v1',
      watchFiles: [fixture.styleFile],
    };
    const graph = {
      createPackageStyleCode: vi.fn(async () => stableResult),
      peekPackageStyleCode: vi.fn(() => stableResult),
      getPackageNames: vi.fn(() => [fixture.packageName]),
      invalidateFile: vi.fn(() => fixture.packageName),
      invalidateFileLoadResults: vi.fn(() => fixture.packageName),
      invalidatePackage: vi.fn(),
      invalidateDependencyFile: vi.fn(() => fixture.packageName),
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

    const result = await handleCombinedUpdate(context);

    expect(graph.invalidateDependencyFile).toHaveBeenCalledWith(
      fixture.styleFile,
    );
    expectReturnedModules(result, [componentVirtualId(fixture.componentName)]);
    expect(context.send).not.toHaveBeenCalled();
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
        context.server.environments.client.moduleGraph,
      ),
    ).toBe(false);
    expect(
      context.hmr.hasTrackedStyleDependency(
        nextStyleFile,
        context.server.environments.client.moduleGraph,
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

    context.hmr.pruneStaleVirtualDependencies(
      context.server.environments.client.moduleGraph,
    );

    expect(
      context.hmr.hasTrackedStyleDependency(
        fixture.styleFile,
        context.server.environments.client.moduleGraph,
      ),
    ).toBe(false);
    expect(
      context.hmr.hasTrackedStyleDependency(
        packageStyleFile,
        context.server.environments.client.moduleGraph,
      ),
    ).toBe(true);
  });

  test('throttles stale virtual dependency pruning across rapid changes', async () => {
    const context = createHmrTestContext(graph);
    const prune = vi.spyOn(context.hmr, 'pruneStaleVirtualDependencies');

    context.hmr.scheduleStaleVirtualDependencyPrune(
      context.server.environments.client.moduleGraph,
    );
    context.hmr.scheduleStaleVirtualDependencyPrune(
      context.server.environments.client.moduleGraph,
    );
    context.hmr.scheduleStaleVirtualDependencyPrune(
      context.server.environments.client.moduleGraph,
    );

    expect(prune).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);

    expect(prune).toHaveBeenCalledTimes(2);
  });

  test('cancels trailing stale virtual dependency pruning on close', async () => {
    const context = createHmrTestContext(graph);
    const prune = vi.spyOn(context.hmr, 'pruneStaleVirtualDependencies');

    context.hmr.scheduleStaleVirtualDependencyPrune(
      context.server.environments.client.moduleGraph,
    );
    context.hmr.scheduleStaleVirtualDependencyPrune(
      context.server.environments.client.moduleGraph,
    );
    context.hmr.cancelStaleVirtualDependencyPrune();

    await vi.advanceTimersByTimeAsync(3000);

    expect(prune).toHaveBeenCalledTimes(1);
  });

  test('ignores files outside the workspace style graph', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleCombinedUpdate(context, fixture.outsideFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('ignores workspace source files that are not styles', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleCombinedUpdate(context, fixture.sourceFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('reloads tracked source module dependencies through vite reloadModule', async () => {
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
    expect(context.reloadModule).toHaveBeenCalledWith(trackedDependency.module);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('reloads tracked source modules when no settled snapshot exists', async () => {
    const virtualId = componentVirtualId(fixture.componentName);
    const graph = {
      createPackageStyleCode: vi.fn(async () => ({
        code: 'style-v1',
        watchFiles: [fixture.styleFile],
      })),
      peekPackageStyleCode: vi.fn(() => null),
      getPackageNames: vi.fn(() => [fixture.packageName]),
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
    expect(context.reloadModule).toHaveBeenCalledWith(
      expect.objectContaining({ id: virtualId }),
    );
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
    expect(context.reloadModule).toHaveBeenCalledWith(
      expect.objectContaining({ id: virtualId }),
    );
    expect(context.send).not.toHaveBeenCalled();
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

  test('returns module nodes on repeated hot updates', async () => {
    const context = createHmrTestContext(graph);
    const tracked = trackVirtualStyleDependency(context);

    await handleCombinedUpdate(context);
    const result = await handleCombinedUpdate(context);

    expectReturnedModules(result, [tracked.id]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not send updates when no virtual dependency is tracked', async () => {
    const context = createHmrTestContext(graph);

    const result = await handleCombinedUpdate(context);

    expect(result).toBeUndefined();
    expect(graph.invalidateDependencyFile).toHaveBeenCalledWith(
      fixture.styleFile,
    );
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
    trackVirtualStyleDependency(context);
    await handleCombinedUpdate(context);
    sentPayloads.length = 0;

    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(0);

    vi.setSystemTime(fixture.currentTime + 200);
    context.server.ws.send({ type: 'full-reload' });
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toEqual({ type: 'full-reload' });
  });
});
