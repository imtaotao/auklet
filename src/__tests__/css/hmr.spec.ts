import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AukletCssHmr } from '#auklet/css/vite/hmr';
import type { ModuleCssGraph } from '#auklet/css/core/moduleCssGraph';
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

const packageCssEntries = ['style.css', 'external.css', 'module.css'] as const;

const packageVirtualId = (entry: string) => {
  return `\0auklet-css:${fixture.packageName}/${entry}`;
};

const componentVirtualId = (name: string) => {
  return packageVirtualId(`components/${name}.css`);
};

const browserVirtualPath = (id: string) => {
  return `/@id/${id.replace('\0', '__x00__')}`;
};

const createModule = (id: string): MockModule => ({ id });

const registerModule = (context: HmrTestContext, id: string) => {
  const module = createModule(id);
  context.modules.set(id, module);
  return module;
};

const registerPackageCssModules = (context: HmrTestContext) => {
  return packageCssEntries.map((entry) =>
    registerModule(context, packageVirtualId(entry)),
  );
};

const trackVirtualCssDependency = (
  context: HmrTestContext,
  virtualId = componentVirtualId(fixture.componentName),
) => {
  const module = registerModule(context, virtualId);
  context.hmr.trackVirtualCssDependency(fixture.styleFile, virtualId);
  return { id: virtualId, module };
};

const handleStyleUpdate = (
  context: HmrTestContext,
  file = fixture.styleFile,
) => {
  return context.hmr.handleStyleHotUpdate(createContext(context.server, file));
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
  return {
    getWorkspacePackageNames: vi.fn(() => [fixture.packageName]),
    isWorkspaceSourceGraphFile: vi.fn((file: string) =>
      file.startsWith(`${fixture.workspaceRoot}/packages/`),
    ),
    isStyleFile: vi.fn((file: string) => file.endsWith('.css')),
  } as unknown as ModuleCssGraph;
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

const createHmrTestContext = (graph: ModuleCssGraph) => {
  const server = createServer();
  const hmr = new AukletCssHmr(() => graph);

  return {
    hmr,
    ...server,
  };
};

describe('AukletCssHmr', () => {
  let graph: ModuleCssGraph;

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

  test('sends js updates for tracked virtual css dependencies', () => {
    const context = createHmrTestContext(graph);
    const trackedDependency = trackVirtualCssDependency(context);
    const packageModules = registerPackageCssModules(context);

    const result = handleStyleUpdate(context);

    expect(result).toEqual([]);
    expect(context.invalidateModule).toHaveBeenCalledWith(
      trackedDependency.module,
    );
    for (const module of packageModules) {
      expect(context.invalidateModule).toHaveBeenCalledWith(module);
    }
    expectJsUpdates(context, [trackedDependency.id]);
  });

  test('ignores files outside the workspace style graph', () => {
    const context = createHmrTestContext(graph);

    const result = handleStyleUpdate(context, fixture.outsideFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('ignores workspace source files that are not styles', () => {
    const context = createHmrTestContext(graph);

    const result = handleStyleUpdate(context, fixture.sourceFile);

    expect(result).toBeUndefined();
    expect(context.send).not.toHaveBeenCalled();
    expect(context.invalidateModule).not.toHaveBeenCalled();
  });

  test('ignores duplicate updates in a short time window', () => {
    const context = createHmrTestContext(graph);

    trackVirtualCssDependency(context);
    handleStyleUpdate(context);
    context.send.mockClear();

    const result = handleStyleUpdate(context);

    expect(result).toEqual([]);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('does not send updates when no virtual dependency is tracked', () => {
    const context = createHmrTestContext(graph);

    const [packageModule] = registerPackageCssModules(context);

    const result = handleStyleUpdate(context);

    expect(result).toEqual([]);
    expect(context.invalidateModule).toHaveBeenCalledWith(packageModule);
    expect(context.send).not.toHaveBeenCalled();
  });

  test('suppresses full reload during the package CSS HMR window', () => {
    const context = createHmrTestContext(graph);

    context.hmr.installFullReloadGuard(context.server);
    handleStyleUpdate(context);
    context.send.mockClear();

    context.server.ws.send({ type: 'full-reload' });
    expect(context.send).not.toHaveBeenCalled();

    vi.setSystemTime(fixture.currentTime + 200);
    context.server.ws.send({ type: 'full-reload' });
    expect(context.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });
});
