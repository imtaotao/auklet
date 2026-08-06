import type {
  EnvironmentModuleGraph,
  EnvironmentModuleNode,
  ViteDevServer,
} from 'vite';
import {
  isCssModuleCssVirtualModuleId,
  isCssModuleVirtualModuleId,
} from '#auklet/css/vite/cssModuleVirtualId';

export type ModuleGraphLookup = Pick<EnvironmentModuleGraph, 'getModuleById'>;

export function resolveVirtualModuleNode(
  moduleGraph: ModuleGraphLookup,
  virtualId: string,
) {
  const candidates = new Set<string>([virtualId]);
  if (!virtualId.startsWith('\0')) {
    candidates.add(`\0${virtualId}`);
  } else {
    candidates.add(virtualId.slice(1));
  }

  for (const id of candidates) {
    const module = moduleGraph.getModuleById(id);
    if (module) return module;
  }

  return undefined;
}

export function prepareCssModuleHotUpdateGraph(
  modules: Array<EnvironmentModuleNode>,
) {
  for (const module of modules) {
    if (!isCssModuleVirtualModuleId(module.id)) continue;

    if (isCssModuleCssVirtualModuleId(module.id)) {
      module.isSelfAccepting = true;
      continue;
    }

    module.isSelfAccepting = false;
  }
}

export function dedupeModuleNodes(modules: Array<EnvironmentModuleNode>) {
  const seen = new Set<string>();
  const deduped: Array<EnvironmentModuleNode> = [];

  for (const module of modules) {
    if (!module.id || seen.has(module.id)) continue;
    seen.add(module.id);
    deduped.push(module);
  }

  return deduped;
}

export function collectVirtualHotUpdateModules(options: {
  moduleGraph: ModuleGraphLookup;
  virtualIds: Array<string>;
}) {
  const modules: Array<EnvironmentModuleNode> = [];

  for (const virtualId of options.virtualIds) {
    const module = resolveVirtualModuleNode(options.moduleGraph, virtualId);
    if (!module) continue;
    modules.push(module);
  }

  return modules;
}

export function invalidateModuleInEnvironments(
  server: Pick<ViteDevServer, 'environments'>,
  virtualId: string,
) {
  for (const environment of Object.values(server.environments)) {
    const module = environment.moduleGraph.getModuleById(virtualId);
    if (!module) continue;
    environment.moduleGraph.invalidateModule(module);
  }
}
