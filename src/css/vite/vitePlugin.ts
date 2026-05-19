import fs from 'node:fs';
import path from 'node:path';
import type { HotUpdateOptions, ModuleNode, Plugin, ViteDevServer } from 'vite';
import {
  ModuleCssGraph,
  type ModuleCssGraphOptions,
} from '#auklet/css/core/moduleCssGraph';
import { AukletCssHmr } from '#auklet/css/vite/hmr';

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

const createModuleCssGraph = (
  options: AukletCssPluginOptions,
  viteRoot: string,
) => {
  const workspaceRoot =
    options.workspaceRoot ?? findWorkspaceRoot(viteRoot) ?? process.cwd();

  return new ModuleCssGraph({
    ...options,
    workspaceRoot,
  });
};

const invalidateVirtualModules = (
  server: Pick<ViteDevServer, 'moduleGraph'>,
  graph: ModuleCssGraph,
) => {
  const modules: Array<ModuleNode> = [];
  for (const packageName of graph.getWorkspacePackageNames()) {
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

export type AukletCssPluginOptions = Partial<
  Pick<ModuleCssGraphOptions, 'workspaceRoot'>
> &
  Omit<ModuleCssGraphOptions, 'workspaceRoot'>;

export function aukletCssPlugin(options: AukletCssPluginOptions = {}) {
  let graph: ModuleCssGraph | null = null;

  const getGraph = () => {
    if (!graph) {
      graph = createModuleCssGraph(options, process.cwd());
    }
    return graph;
  };

  const hmr = new AukletCssHmr(getGraph);

  return {
    name: 'auklet-css',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config: { root: string }) {
      graph = createModuleCssGraph(options, config.root);
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
      if (!graph.parsePackageCssId(cleanId)) return null;
      return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId}`;
    },

    async load(this: { addWatchFile?: (file: string) => void }, id: string) {
      if (!id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)) return null;

      const originalId = id.slice(RESOLVED_VIRTUAL_ID_PREFIX.length);
      const graph = getGraph();
      const parsed = graph.parsePackageCssId(originalId);
      if (!parsed) return null;

      const result = await graph.createPackageCssCode(parsed);
      for (const file of result.watchFiles) {
        hmr.trackVirtualCssDependency(file, id);
        this.addWatchFile?.(file);
      }
      return result.code;
    },

    configureServer(server: ViteDevServer) {
      const graph = getGraph();
      hmr.installFullReloadGuard(server);
      server.watcher.add(graph.getWatchRoots());

      const invalidateCssGraph = (file: string) => {
        if (!graph.isWorkspaceSourceGraphFile(file)) return false;
        invalidateVirtualModules(server, graph);
        return true;
      };

      const reloadCssGraph = (file: string) => {
        if (!invalidateCssGraph(file)) return;
        server.ws.send({ type: 'full-reload' });
      };

      const handleSourceAddOrUnlink = (file: string) => {
        if (graph.isStyleFile(file)) {
          invalidateCssGraph(file);
          return;
        }
        reloadCssGraph(file);
      };

      server.watcher.on('add', handleSourceAddOrUnlink);
      server.watcher.on('unlink', handleSourceAddOrUnlink);
      server.watcher.on('change', (file) => {
        if (graph.isCssConfigFile(file)) {
          reloadCssGraph(file);
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
