import path from 'node:path';
import { isString, throttle } from 'aidly';
import type { HotPayload, HotUpdateOptions, ViteDevServer } from 'vite';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { normalizeFileKey } from '#auklet/utils';
import { createAukletLogger } from '#auklet/logger';

// package CSS 的 HMR 不能直接走 Vite 原生 CSS 文件链路：
// 1. 浏览器 import 的是 auklet-css:* 虚拟 CSS 模块，不是真实的
//   packages/*/src/**/*.css 文件，所以真实 CSS 变化时 Vite 的 modules 可能为空。
// 2. Vite dev 会把 CSS 转成自接受的 JS 模块，重新执行模块里的 updateStyle()
//   才能更新样式，因此这里手动发送 js-update，而不是 css-update。
// 3. @tailwindcss/vite 会在相关 CSS 变化时主动发 full-reload。package CSS 已由
//   这个插件接管 HMR 时，需要在一个很短的窗口内吞掉这次 reload。

type VirtualIdsByDependency = Map<string, Set<string>>;
type TrackedVirtualStyleFileKind = 'entry' | 'dependency';
type FilesByVirtualId = Map<string, Map<string, TrackedVirtualStyleFileKind>>;
type TrackedVirtualStyleFileEntry = {
  id: string;
  parsed: Parameters<ModuleStyleGraph['createPackageStyleCode']>[0];
  kind: TrackedVirtualStyleFileKind;
};

export type AukletStyleHmrOptions = {
  pruneDelayMs?: number;
};

const FULL_RELOAD_SUPPRESS_MS = 100;
const DUPLICATE_UPDATE_IGNORE_MS = 500;
const RESOLVED_VIRTUAL_ID_PREFIX = '\0auklet-css:';
const logger = createAukletLogger({ scope: 'css:vite' });

const toBrowserVirtualPath = (id: string) => {
  return `/@id/${id.replace('\0', '__x00__')}`;
};

const getRelativeFile = (file: string) => {
  return path.relative(process.cwd(), file);
};

const addVirtualStyleDependency = (
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  file: string,
  virtualId: string,
  kind: TrackedVirtualStyleFileKind,
) => {
  const normalizedFile = normalizeFileKey(file);
  const values =
    virtualIdsByDependency.get(normalizedFile) ?? new Set<string>();
  values.add(virtualId);
  virtualIdsByDependency.set(normalizedFile, values);

  const files =
    filesByVirtualId.get(virtualId) ??
    new Map<string, TrackedVirtualStyleFileKind>();
  const previousKind = files.get(normalizedFile);
  files.set(
    normalizedFile,
    previousKind === 'entry' || kind === 'entry' ? 'entry' : kind,
  );
  filesByVirtualId.set(virtualId, files);
};

const removeVirtualStyleDependency = (
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  file: string,
  virtualId: string,
) => {
  const normalizedFile = normalizeFileKey(file);
  const values = virtualIdsByDependency.get(normalizedFile);
  if (values) {
    values.delete(virtualId);
    if (!values.size) {
      virtualIdsByDependency.delete(normalizedFile);
    }
  }

  const files = filesByVirtualId.get(virtualId);
  if (files) {
    files.delete(normalizedFile);
    if (!files.size) {
      filesByVirtualId.delete(virtualId);
    }
  }
};

const sameStringSets = (left: Array<string>, right: Array<string>) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== left.length) return false;
  return left.every((item) => rightSet.has(item));
};

const createJsUpdates = (virtualIds: Array<string>, timestamp: number) => {
  return virtualIds.map((id) => {
    const browserPath = toBrowserVirtualPath(id);
    return {
      type: 'js-update' as const,
      path: browserPath,
      acceptedPath: browserPath,
      timestamp,
      explicitImportRequired: false,
      isWithinCircularImport: false,
    };
  });
};

export class AukletStyleHmr {
  private readonly lastUpdateTimes = new Map<string, number>();
  private suppressFullReloadUntil = 0;
  private readonly virtualIdsByDependency: VirtualIdsByDependency = new Map();
  private readonly filesByVirtualId: FilesByVirtualId = new Map();
  private readonly schedulePruneStaleVirtualDependencies;
  private readonly pruneDelayMs: number;

  constructor(
    private readonly graph: () => ModuleStyleGraph,
    options: AukletStyleHmrOptions = {},
  ) {
    this.pruneDelayMs = options.pruneDelayMs ?? 2 * 60 * 1000;
    this.schedulePruneStaleVirtualDependencies = throttle(
      this.pruneDelayMs,
      (moduleGraph: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>) =>
        this.pruneStaleVirtualDependencies(moduleGraph),
    );
  }

  trackVirtualStyleDependency(
    file: string,
    virtualId: string,
    kind: TrackedVirtualStyleFileKind = 'dependency',
  ) {
    addVirtualStyleDependency(
      this.virtualIdsByDependency,
      this.filesByVirtualId,
      file,
      virtualId,
      kind,
    );
  }

  replaceVirtualStyleDependency(
    virtualId: string,
    files: Array<string>,
    fileKinds: Array<{
      file: string;
      kind: TrackedVirtualStyleFileKind;
    }> = [],
  ) {
    const normalizedFiles = new Set(
      files.map((file) => normalizeFileKey(file)),
    );
    const previousFiles = this.filesByVirtualId.get(virtualId) ?? new Map();
    const nextKinds = new Map(
      fileKinds.map(
        (item) => [normalizeFileKey(item.file), item.kind] as const,
      ),
    );

    for (const file of previousFiles.keys()) {
      if (normalizedFiles.has(file)) continue;
      removeVirtualStyleDependency(
        this.virtualIdsByDependency,
        this.filesByVirtualId,
        file,
        virtualId,
      );
    }

    for (const file of normalizedFiles) {
      addVirtualStyleDependency(
        this.virtualIdsByDependency,
        this.filesByVirtualId,
        file,
        virtualId,
        nextKinds.get(file) ?? 'dependency',
      );
    }
  }

  hasTrackedStyleDependency(
    file: string,
    moduleGraph?: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    return this.getDependencyVirtualIds(file, moduleGraph).length > 0;
  }

  pruneStaleVirtualDependencies(
    moduleGraph: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    for (const [normalizedFile, virtualIds] of this.virtualIdsByDependency) {
      for (const virtualId of Array.from(virtualIds)) {
        if (moduleGraph.getModuleById(virtualId)) continue;
        removeVirtualStyleDependency(
          this.virtualIdsByDependency,
          this.filesByVirtualId,
          normalizedFile,
          virtualId,
        );
      }
    }
  }

  scheduleStaleVirtualDependencyPrune(
    moduleGraph: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    this.schedulePruneStaleVirtualDependencies(moduleGraph);
  }

  cancelStaleVirtualDependencyPrune() {
    this.schedulePruneStaleVirtualDependencies.cancel();
  }

  installFullReloadGuard(server: Pick<ViteDevServer, 'ws'>) {
    const send = server.ws.send.bind(server.ws) as ViteDevServer['ws']['send'];
    server.ws.send = ((payload: HotPayload, data?: unknown) => {
      if (
        !isString(payload) &&
        payload.type === 'full-reload' &&
        this.shouldSuppressFullReload()
      ) {
        logger.info('suppressed package css full-reload');
        return;
      }
      if (isString(payload)) {
        send(payload, data as never);
        return;
      }
      send(payload);
    }) as ViteDevServer['ws']['send'];
  }

  async handleStyleHotUpdate(context: HotUpdateOptions) {
    const graph = this.graph();
    if (!graph.isStyleFile(context.file)) {
      return undefined;
    }

    const isSourceGraphFile = graph.isSourceGraphFile(context.file);
    const trackedEntries = this.getTrackedStyleFileEntries(
      context.file,
      context.server.moduleGraph,
    );
    if (!trackedEntries.length) {
      if (isSourceGraphFile) {
        graph.invalidateFile(context.file);
      }
      return undefined;
    }

    const entryEntries = isSourceGraphFile
      ? trackedEntries.filter((item) => item.kind === 'entry')
      : [];
    const dependencyEntries = isSourceGraphFile
      ? trackedEntries.filter((item) => item.kind === 'dependency')
      : trackedEntries;

    const previousResults = entryEntries.length
      ? this.createTrackedVirtualStyleResults(graph, entryEntries)
      : null;

    if (isSourceGraphFile) {
      graph.invalidateFileLoadResults(context.file);
    } else {
      this.invalidateTrackedVirtualPackages(graph, dependencyEntries);
    }

    if (this.isDuplicateUpdate(context.file)) {
      return [];
    }

    const dependencyUpdates = dependencyEntries.length
      ? this.createTrackedVirtualStyleUpdates(
          context.server,
          dependencyEntries,
          context.timestamp,
        )
      : [];
    const entryUpdates = entryEntries.length
      ? await this.refreshTrackedVirtualStyleUpdates(
          context.server,
          entryEntries,
          previousResults!,
          context.timestamp,
        )
      : [];
    const updates = [...dependencyUpdates, ...entryUpdates];

    if (!updates.length) {
      return undefined;
    }

    this.suppressFullReload();
    context.server.ws.send({
      type: 'update',
      updates,
    });
    logger.info(
      `package css hmr ${getRelativeFile(context.file)} tracked=${trackedEntries.length} updates=${updates.length}`,
    );
    return [];
  }

  async handleSourceModuleChange(
    server: Pick<ViteDevServer, 'moduleGraph' | 'ws'>,
    file: string,
  ) {
    const graph = this.graph();
    if (!graph.isSourceGraphFile(file) || !graph.isSourceModuleFile(file)) {
      return false;
    }

    const virtualIds = this.getDependencyVirtualIds(file, server.moduleGraph);
    if (!virtualIds.length) {
      graph.invalidateFile(file);
      return false;
    }
    const parsedVirtualIds = this.parseTrackedVirtualIds(graph, virtualIds);
    if (!parsedVirtualIds.length) {
      graph.invalidateFile(file);
      return false;
    }

    const previousResults = this.createTrackedVirtualStyleResults(
      graph,
      parsedVirtualIds,
    );
    graph.invalidateFile(file);

    const updates = await this.refreshTrackedVirtualStyleUpdates(
      server,
      parsedVirtualIds,
      previousResults,
      Date.now(),
    );
    if (!updates.length) {
      return false;
    }
    this.suppressFullReload();
    server.ws.send({
      type: 'update',
      updates,
    });
    logger.info(
      `package css source hmr ${getRelativeFile(file)} tracked=${parsedVirtualIds.length} updates=${updates.length}`,
    );
    return true;
  }

  private parseTrackedVirtualIds(
    graph: ModuleStyleGraph,
    virtualIds: Array<string>,
  ) {
    return virtualIds
      .map((id) => this.parseTrackedVirtualId(graph, id))
      .filter((item): item is TrackedVirtualStyleFileEntry => item !== null);
  }

  private createTrackedVirtualStyleUpdates(
    server: Pick<ViteDevServer, 'moduleGraph' | 'ws'>,
    parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
    timestamp: number,
  ) {
    const changedVirtualIds: Array<string> = [];
    for (const item of parsedVirtualIds) {
      changedVirtualIds.push(item.id);
      const module = server.moduleGraph.getModuleById(item.id);
      if (module) {
        server.moduleGraph.invalidateModule(module);
      }
    }

    return createJsUpdates(changedVirtualIds, timestamp);
  }

  private invalidateTrackedVirtualPackages(
    graph: ModuleStyleGraph,
    parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
  ) {
    const packageNames = new Set(
      parsedVirtualIds.map((item) => item.parsed.packageName),
    );
    for (const packageName of packageNames) {
      graph.invalidatePackage(packageName);
    }
  }

  private getDependencyVirtualIds(
    file: string,
    moduleGraph?: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    const normalizedFile = normalizeFileKey(file);
    const virtualIds = Array.from(
      this.virtualIdsByDependency.get(normalizedFile) ?? [],
    );
    if (!moduleGraph) {
      return virtualIds;
    }
    const liveVirtualIds = virtualIds.filter((virtualId) =>
      moduleGraph.getModuleById(virtualId),
    );
    if (liveVirtualIds.length !== virtualIds.length) {
      const liveSet = new Set(liveVirtualIds);
      for (const virtualId of virtualIds) {
        if (liveSet.has(virtualId)) continue;
        removeVirtualStyleDependency(
          this.virtualIdsByDependency,
          this.filesByVirtualId,
          normalizedFile,
          virtualId,
        );
      }
    }
    return liveVirtualIds;
  }

  private getTrackedStyleFileEntries(
    file: string,
    moduleGraph?: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    const normalizedFile = normalizeFileKey(file);
    const virtualIds = Array.from(
      this.virtualIdsByDependency.get(normalizedFile) ?? [],
    );
    const entries = virtualIds
      .map((id) =>
        this.parseTrackedVirtualIdWithKind(id, normalizedFile, moduleGraph),
      )
      .filter((item): item is TrackedVirtualStyleFileEntry => Boolean(item));
    if (!moduleGraph) {
      return entries;
    }
    if (entries.length !== virtualIds.length) {
      const liveSet = new Set(entries.map((item) => item.id));
      for (const virtualId of virtualIds) {
        if (liveSet.has(virtualId)) continue;
        removeVirtualStyleDependency(
          this.virtualIdsByDependency,
          this.filesByVirtualId,
          normalizedFile,
          virtualId,
        );
      }
    }
    return entries;
  }

  private createTrackedVirtualStyleResults(
    graph: ModuleStyleGraph,
    parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
  ) {
    const previousResults = new Map<
      string,
      Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>> | null
    >();

    for (const item of parsedVirtualIds) {
      previousResults.set(item.id, graph.peekPackageStyleCode(item.parsed));
    }

    return previousResults;
  }

  private parseTrackedVirtualId(
    graph: ModuleStyleGraph,
    id: string,
  ): TrackedVirtualStyleFileEntry | null {
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
  }

  private parseTrackedVirtualIdWithKind(
    id: string,
    normalizedFile: string,
    moduleGraph?: Pick<ViteDevServer['moduleGraph'], 'getModuleById'>,
  ) {
    if (moduleGraph && !moduleGraph.getModuleById(id)) {
      return null;
    }

    const parsed = this.parseTrackedVirtualId(this.graph(), id);
    if (!parsed) return null;

    const kind =
      this.filesByVirtualId.get(id)?.get(normalizedFile) ?? 'dependency';
    return {
      ...parsed,
      kind,
    };
  }

  private async refreshTrackedVirtualStyleUpdates(
    server: Pick<ViteDevServer, 'moduleGraph' | 'ws'>,
    parsedVirtualIds: Array<TrackedVirtualStyleFileEntry>,
    previousResults: Map<
      string,
      Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>> | null
    >,
    timestamp: number,
  ) {
    const graph = this.graph();
    const changedVirtualIds: Array<string> = [];
    for (const item of parsedVirtualIds) {
      const nextResult = await graph.createPackageStyleCode(item.parsed);
      const previousResult = previousResults.get(item.id);
      if (
        !previousResult ||
        !this.sameStyleLoadResult(previousResult, nextResult)
      ) {
        changedVirtualIds.push(item.id);
        const module = server.moduleGraph.getModuleById(item.id);
        if (module) {
          server.moduleGraph.invalidateModule(module);
        }
      }
    }

    return createJsUpdates(changedVirtualIds, timestamp);
  }

  private sameStyleLoadResult(
    left: Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>>,
    right: Awaited<ReturnType<ModuleStyleGraph['createPackageStyleCode']>>,
  ) {
    return (
      left.code === right.code &&
      sameStringSets(left.watchFiles, right.watchFiles) &&
      sameStringSets(
        left.dependencyPackages ?? [],
        right.dependencyPackages ?? [],
      )
    );
  }

  private suppressFullReload() {
    this.suppressFullReloadUntil = Date.now() + FULL_RELOAD_SUPPRESS_MS;
  }

  private shouldSuppressFullReload() {
    return Date.now() <= this.suppressFullReloadUntil;
  }

  private isDuplicateUpdate(file: string) {
    const now = Date.now();
    const normalizedFile = normalizeFileKey(file);
    const lastUpdateTime = this.lastUpdateTimes.get(normalizedFile) ?? 0;
    const isDuplicate = now - lastUpdateTime < DUPLICATE_UPDATE_IGNORE_MS;

    this.lastUpdateTimes.set(normalizedFile, now);

    return isDuplicate;
  }
}
