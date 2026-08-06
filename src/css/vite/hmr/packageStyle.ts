import path from 'node:path';
import type { ViteDevServer } from 'vite';
import type { VirtualDependencyTracker } from '#auklet/css/vite/hmr/tracker';
import {
  collectVirtualHotUpdateModules,
  type ModuleGraphLookup,
} from '#auklet/css/vite/hmr/propagate';
import type {
  TrackedVirtualStyleFileEntry,
  TrackedVirtualStyleFileKind,
} from '#auklet/css/vite/hmr/shared';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { normalizeFileKey } from '#auklet/utils';
import { createAukletLogger } from '#auklet/logger';

const RESOLVED_VIRTUAL_ID_PREFIX = '\0auklet-css:';

const logger = createAukletLogger({ scope: 'css:vite' });

const getRelativeFile = (file: string) => {
  return path.relative(process.cwd(), file);
};

const sameStringSets = (left: Array<string>, right: Array<string>) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== left.length) return false;
  return left.every((item) => rightSet.has(item));
};

const parseTrackedVirtualId = (
  graph: ModuleStyleGraph,
  id: string,
): TrackedVirtualStyleFileEntry | null => {
  const parsedId = id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)
    ? id.slice(RESOLVED_VIRTUAL_ID_PREFIX.length)
    : id;
  const parsed = graph.parsePackageStyleId(parsedId);
  if (!parsed || !graph.getPackageNames().includes(parsed.packageName)) {
    return null;
  }
  return {
    id,
    parsed,
    kind: 'dependency' as const,
  };
};

const parseTrackedVirtualIds = (
  graph: ModuleStyleGraph,
  virtualIds: Array<string>,
) => {
  return virtualIds
    .map((id) => parseTrackedVirtualId(graph, id))
    .filter((item): item is TrackedVirtualStyleFileEntry => item !== null);
};

const parseTrackedVirtualIdWithKind = (
  graph: ModuleStyleGraph,
  tracker: VirtualDependencyTracker,
  id: string,
  normalizedFile: string,
  moduleGraph?: ModuleGraphLookup,
) => {
  if (moduleGraph && !moduleGraph.getModuleById(id)) {
    return null;
  }

  const parsed = parseTrackedVirtualId(graph, id);
  if (!parsed) return null;

  const kind =
    tracker.getFilesByVirtualId(id).get(normalizedFile) ?? 'dependency';
  return {
    ...parsed,
    kind,
  };
};

const getTrackedStyleFileEntries = (
  graph: ModuleStyleGraph,
  tracker: VirtualDependencyTracker,
  file: string,
  moduleGraph?: ModuleGraphLookup,
) => {
  const normalizedFile = normalizeFileKey(file);
  const virtualIds = tracker.listVirtualIds(file);
  const entries = virtualIds
    .map((id) =>
      parseTrackedVirtualIdWithKind(
        graph,
        tracker,
        id,
        normalizedFile,
        moduleGraph,
      ),
    )
    .filter((item): item is TrackedVirtualStyleFileEntry => Boolean(item));

  if (!moduleGraph) {
    return entries;
  }

  if (entries.length !== virtualIds.length) {
    const liveSet = new Set(entries.map((item) => item.id));
    for (const virtualId of virtualIds) {
      if (liveSet.has(virtualId)) continue;
      tracker.unlink(normalizedFile, virtualId);
    }
  }

  return entries;
};

const createTrackedVirtualStyleResults = (
  graph: ModuleStyleGraph,
  parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
) => {
  const previousResults = new Map<
    string,
    Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>> | null
  >();

  for (const item of parsedVirtualIds) {
    previousResults.set(item.id, graph.peekPackageStyleCode(item.parsed));
  }

  return previousResults;
};

const createTrackedVirtualStyleUpdates = (
  moduleGraph: ModuleGraphLookup,
  parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
) => {
  return collectVirtualHotUpdateModules({
    moduleGraph,
    virtualIds: parsedVirtualIds.map((item) => item.id),
  });
};

const invalidateTrackedVirtualPackages = (
  graph: ModuleStyleGraph,
  parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
) => {
  const packageNames = new Set(
    parsedVirtualIds.map((item) => item.parsed.packageName),
  );
  for (const packageName of packageNames) {
    graph.invalidatePackage(packageName);
  }
};

const sameStyleLoadResult = (
  left: Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>>,
  right: Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>>,
) => {
  return (
    left.code === right.code &&
    sameStringSets(left.watchFiles, right.watchFiles) &&
    sameStringSets(
      left.dependencyPackages ?? [],
      right.dependencyPackages ?? [],
    )
  );
};

const refreshTrackedVirtualStyleUpdates = async (
  graph: ModuleStyleGraph,
  moduleGraph: ModuleGraphLookup,
  parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
  previousResults: Map<
    string,
    Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>> | null
  >,
) => {
  const changedVirtualIds: Array<string> = [];
  for (const item of parsedVirtualIds) {
    const nextResult = await graph.createPackageStyleCode(item.parsed);
    const previousResult = previousResults.get(item.id);
    if (!previousResult || !sameStyleLoadResult(previousResult, nextResult)) {
      changedVirtualIds.push(item.id);
    }
  }

  return collectVirtualHotUpdateModules({
    moduleGraph,
    virtualIds: changedVirtualIds,
  });
};

export type PackageStyleHotUpdatePlan = {
  trackedCount: number;
  entryEntries: Array<TrackedVirtualStyleFileEntry>;
  dependencyEntries: Array<TrackedVirtualStyleFileEntry>;
  previousResults: Map<
    string,
    Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>> | null
  > | null;
  isSourceGraphFile: boolean;
};

export function planPackageStyleHotUpdate(options: {
  graph: ModuleStyleGraph;
  tracker: VirtualDependencyTracker;
  file: string;
  moduleGraph: ModuleGraphLookup;
}) {
  const { graph, tracker, file, moduleGraph } = options;
  if (!graph.isStyleFile(file)) {
    return null;
  }

  const isSourceGraphFile = graph.isSourceGraphFile(file);
  const trackedEntries = getTrackedStyleFileEntries(
    graph,
    tracker,
    file,
    moduleGraph,
  );
  if (!trackedEntries.length) {
    if (isSourceGraphFile) {
      graph.invalidateFile(file);
    }
    return null;
  }

  const entryEntries = isSourceGraphFile
    ? trackedEntries.filter((item) => item.kind === 'entry')
    : [];
  const dependencyEntries = isSourceGraphFile
    ? trackedEntries.filter((item) => item.kind === 'dependency')
    : trackedEntries;

  return {
    trackedCount: trackedEntries.length,
    entryEntries,
    dependencyEntries,
    previousResults: entryEntries.length
      ? createTrackedVirtualStyleResults(graph, entryEntries)
      : null,
    isSourceGraphFile,
  } satisfies PackageStyleHotUpdatePlan;
}

export async function collectPackageStyleHotUpdateModules(options: {
  graph: ModuleStyleGraph;
  file: string;
  moduleGraph: ModuleGraphLookup;
  plan: PackageStyleHotUpdatePlan;
}) {
  const { plan } = options;

  if (plan.isSourceGraphFile) {
    options.graph.invalidateFileLoadResults(options.file);
  } else {
    invalidateTrackedVirtualPackages(options.graph, plan.dependencyEntries);
  }

  const dependencyModules = plan.dependencyEntries.length
    ? createTrackedVirtualStyleUpdates(
        options.moduleGraph,
        plan.dependencyEntries,
      )
    : [];
  const entryModules = plan.entryEntries.length
    ? await refreshTrackedVirtualStyleUpdates(
        options.graph,
        options.moduleGraph,
        plan.entryEntries,
        plan.previousResults!,
      )
    : [];

  return [...dependencyModules, ...entryModules];
}

export async function handlePackageSourceModuleChange(options: {
  graph: ModuleStyleGraph;
  tracker: VirtualDependencyTracker;
  server: Pick<ViteDevServer, 'environments'>;
  file: string;
  suppressFullReload: () => void;
}) {
  const { graph, tracker, server, file } = options;
  const moduleGraph = server.environments.client.moduleGraph;
  if (!graph.isSourceGraphFile(file) || !graph.isSourceModuleFile(file)) {
    return false;
  }

  const virtualIds = tracker.getLiveVirtualIds(file, moduleGraph);
  if (!virtualIds.length) {
    graph.invalidateFile(file);
    return false;
  }
  const parsedVirtualIds = parseTrackedVirtualIds(graph, virtualIds);
  if (!parsedVirtualIds.length) {
    graph.invalidateFile(file);
    return false;
  }

  const previousResults = createTrackedVirtualStyleResults(
    graph,
    parsedVirtualIds,
  );
  graph.invalidateFile(file);

  const modules = await refreshTrackedVirtualStyleUpdates(
    graph,
    moduleGraph,
    parsedVirtualIds,
    previousResults,
  );
  if (!modules.length) {
    return false;
  }

  for (const module of modules) {
    await server.environments.client.reloadModule(module);
  }
  options.suppressFullReload();
  logger.info(
    `package css source hmr ${getRelativeFile(file)} tracked=${parsedVirtualIds.length} updates=${modules.length}`,
  );
  return true;
}

export type PackageStyleDependencyKind = {
  file: string;
  kind: TrackedVirtualStyleFileKind;
};

export function replacePackageStyleDependency(
  tracker: VirtualDependencyTracker,
  virtualId: string,
  files: Array<string>,
  fileKinds: Array<PackageStyleDependencyKind> = [],
) {
  tracker.replace(virtualId, files, fileKinds);
}
