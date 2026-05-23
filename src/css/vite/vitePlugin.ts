import fs from 'node:fs';
import path from 'node:path';
import type { HotUpdateOptions, ModuleNode, Plugin, ViteDevServer } from 'vite';
import type { ModuleStyleGraphOptions } from '#auklet/css/vite/moduleGraph/types';
import { AukletStyleHmr } from '#auklet/css/vite/hmr';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const VIRTUAL_ID_PREFIX = 'virtual:auklet-css:';
const RESOLVED_VIRTUAL_ID_PREFIX = '\0auklet-css:';
const BROWSER_VIRTUAL_ID_PREFIX = 'auklet-css:';

const stripQuery = (id: string) => id.split('?')[0];

const toResolvedVirtualId = (id: string) => {
  if (id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)) {
    return id;
  }
  if (id.startsWith(BROWSER_VIRTUAL_ID_PREFIX)) {
    return `${RESOLVED_VIRTUAL_ID_PREFIX}${id.slice(
      BROWSER_VIRTUAL_ID_PREFIX.length,
    )}`;
  }
  return null;
};

const findWorkspaceRoot = (startDir: string) => {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, WORKSPACE_FILE))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const createModuleStyleGraph = (
  options: AukletStylePluginOptions,
  viteRoot: string,
) => {
  const mode = options.mode ?? 'package';
  const root = options.root ?? resolveGraphRoot(mode, viteRoot);

  return new ModuleStyleGraph({
    ...options,
    mode,
    root,
  });
};

const resolveGraphRoot = (
  mode: NonNullable<ModuleStyleGraphOptions['mode']>,
  viteRoot: string,
) => {
  if (mode === 'monorepo') return findWorkspaceRoot(viteRoot) ?? process.cwd();
  return viteRoot;
};

const invalidateVirtualModules = (
  server: Pick<ViteDevServer, 'moduleGraph'>,
  graph: ModuleStyleGraph,
) => {
  const modules: Array<ModuleNode> = [];
  for (const packageName of graph.getPackageNames()) {
    for (const entry of ['style.css', 'external.css', 'module.css']) {
      const module = server.moduleGraph.getModuleById(
        `${RESOLVED_VIRTUAL_ID_PREFIX}${packageName}/${entry}`,
      );
      if (!module) continue;
      server.moduleGraph.invalidateModule(module);
      modules.push(module);
    }
  }
  return modules;
};

export type AukletStylePluginOptions = Partial<
  Pick<ModuleStyleGraphOptions, 'root' | 'mode'>
> &
  Omit<ModuleStyleGraphOptions, 'root'>;

export function aukletStylePlugin(options: AukletStylePluginOptions = {}) {
  let graph: ModuleStyleGraph | null = null;

  const getGraph = () => {
    if (!graph) {
      graph = createModuleStyleGraph(options, process.cwd());
    }
    return graph;
  };

  const hmr = new AukletStyleHmr(getGraph);

  return {
    name: 'auklet-css',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config: { root: string }) {
      graph = createModuleStyleGraph(options, config.root);
    },

    resolveId(id: string) {
      const graph = getGraph();
      const cleanId = stripQuery(id);
      const resolvedVirtualId = toResolvedVirtualId(cleanId);
      if (resolvedVirtualId) return resolvedVirtualId;
      if (cleanId.startsWith(VIRTUAL_ID_PREFIX)) {
        return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId.slice(
          VIRTUAL_ID_PREFIX.length,
        )}`;
      }
      if (!graph.parsePackageStyleId(cleanId)) return null;
      return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId}`;
    },

    async load(this: { addWatchFile?: (file: string) => void }, id: string) {
      if (!id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)) return null;

      const originalId = id.slice(RESOLVED_VIRTUAL_ID_PREFIX.length);
      const graph = getGraph();
      const parsed = graph.parsePackageStyleId(originalId);
      if (!parsed) return null;

      const result = await graph.createPackageStyleCode(parsed);
      for (const file of result.watchFiles) {
        hmr.trackVirtualStyleDependency(file, id);
        this.addWatchFile?.(file);
      }
      return result.code;
    },

    async configureServer(server: ViteDevServer) {
      const graph = getGraph();
      hmr.installFullReloadGuard(server);
      server.watcher.add(await graph.getWatchRoots());

      const invalidateStyleGraph = (file: string) => {
        if (!graph.isSourceGraphFile(file)) return false;
        invalidateVirtualModules(server, graph);
        return true;
      };

      const reloadStyleGraph = (file: string) => {
        if (!invalidateStyleGraph(file)) return;
        server.ws.send({ type: 'full-reload' });
      };

      const handleSourceAddOrUnlink = (file: string) => {
        if (graph.isStyleFile(file)) {
          invalidateStyleGraph(file);
          return;
        }
        reloadStyleGraph(file);
      };

      server.watcher.on('add', handleSourceAddOrUnlink);
      server.watcher.on('unlink', handleSourceAddOrUnlink);
      server.watcher.on('change', (file) => {
        if (graph.isStyleConfigFile(file)) {
          reloadStyleGraph(file);
        }
      });
    },

    hotUpdate: {
      order: 'pre',
      handler(context: HotUpdateOptions) {
        return hmr.handleStyleHotUpdate(context);
      },
    },
  } satisfies Plugin;
}
