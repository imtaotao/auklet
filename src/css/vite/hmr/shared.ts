import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';

export type VirtualIdsByDependency = Map<string, Set<string>>;

export type TrackedVirtualStyleFileKind = 'entry' | 'dependency';

export type FilesByVirtualId = Map<
  string,
  Map<string, TrackedVirtualStyleFileKind>
>;

export type TrackedVirtualStyleFileEntry = {
  id: string;
  parsed: Parameters<ModuleStyleGraph['createPackageStyleCode']>[0];
  kind: TrackedVirtualStyleFileKind;
};

export type AukletStyleHmrOptions = {
  pruneDelayMs?: number;
};
