import { normalizeFileKey } from '#auklet/utils';
import type { ModuleGraphLookup } from '#auklet/css/vite/hmr/propagate';
import type {
  FilesByVirtualId,
  TrackedVirtualStyleFileKind,
  VirtualIdsByDependency,
} from '#auklet/css/vite/hmr/shared';

export function addVirtualStyleDependency(
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  file: string,
  virtualId: string,
  kind: TrackedVirtualStyleFileKind,
) {
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
}

export function removeVirtualStyleDependency(
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  file: string,
  virtualId: string,
) {
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
}

export function getLiveDependencyVirtualIds(
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  file: string,
  moduleGraph?: ModuleGraphLookup,
) {
  const normalizedFile = normalizeFileKey(file);
  const virtualIds = Array.from(
    virtualIdsByDependency.get(normalizedFile) ?? [],
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
        virtualIdsByDependency,
        filesByVirtualId,
        normalizedFile,
        virtualId,
      );
    }
  }

  return liveVirtualIds;
}

export function pruneStaleVirtualDependencies(
  virtualIdsByDependency: VirtualIdsByDependency,
  filesByVirtualId: FilesByVirtualId,
  moduleGraph: ModuleGraphLookup,
) {
  for (const [normalizedFile, virtualIds] of virtualIdsByDependency) {
    for (const virtualId of Array.from(virtualIds)) {
      if (moduleGraph.getModuleById(virtualId)) continue;
      removeVirtualStyleDependency(
        virtualIdsByDependency,
        filesByVirtualId,
        normalizedFile,
        virtualId,
      );
    }
  }
}

export class VirtualDependencyTracker {
  private readonly virtualIdsByDependency: VirtualIdsByDependency = new Map();
  private readonly filesByVirtualId: FilesByVirtualId = new Map();

  track(
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

  replace(
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

  replaceDependencies(virtualId: string, files: Array<string>) {
    this.replace(virtualId, files);
  }

  hasTracked(file: string, moduleGraph?: ModuleGraphLookup) {
    return this.getLiveVirtualIds(file, moduleGraph).length > 0;
  }

  getLiveVirtualIds(file: string, moduleGraph?: ModuleGraphLookup) {
    return getLiveDependencyVirtualIds(
      this.virtualIdsByDependency,
      this.filesByVirtualId,
      file,
      moduleGraph,
    );
  }

  listVirtualIds(file: string) {
    const normalizedFile = normalizeFileKey(file);
    return Array.from(this.virtualIdsByDependency.get(normalizedFile) ?? []);
  }

  unlink(file: string, virtualId: string) {
    removeVirtualStyleDependency(
      this.virtualIdsByDependency,
      this.filesByVirtualId,
      file,
      virtualId,
    );
  }

  removeVirtualId(virtualId: string) {
    const files = Array.from(
      this.filesByVirtualId.get(virtualId)?.keys() ?? [],
    );
    for (const file of files) {
      removeVirtualStyleDependency(
        this.virtualIdsByDependency,
        this.filesByVirtualId,
        file,
        virtualId,
      );
    }
  }

  removeDependencyFile(file: string) {
    const normalizedFile = normalizeFileKey(file);
    const virtualIds = Array.from(
      this.virtualIdsByDependency.get(normalizedFile) ?? [],
    );
    for (const virtualId of virtualIds) {
      removeVirtualStyleDependency(
        this.virtualIdsByDependency,
        this.filesByVirtualId,
        normalizedFile,
        virtualId,
      );
    }
  }

  hasAnyLiveVirtualIds(moduleGraph?: ModuleGraphLookup) {
    if (!this.filesByVirtualId.size) return false;
    if (!moduleGraph) return true;

    for (const virtualId of this.filesByVirtualId.keys()) {
      if (moduleGraph.getModuleById(virtualId)) return true;
    }

    return false;
  }

  getFilesByVirtualId(virtualId: string) {
    return this.filesByVirtualId.get(virtualId) ?? new Map();
  }

  pruneStale(moduleGraph: ModuleGraphLookup) {
    pruneStaleVirtualDependencies(
      this.virtualIdsByDependency,
      this.filesByVirtualId,
      moduleGraph,
    );
  }
}
