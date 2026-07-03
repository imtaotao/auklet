import type { PackageStyleLoadResult } from '#auklet/css/vite/moduleGraph/types';

// 合并递归 style graph 加载结果，同时保留 CSS 顺序并去重 watch files。
export function mergeLoadResults(...results: Array<PackageStyleLoadResult>) {
  const watchFileKinds = new Map<string, 'entry' | 'dependency'>();

  for (const result of results) {
    for (const item of result.watchFileKinds ?? []) {
      const currentKind = watchFileKinds.get(item.file);
      if (currentKind === 'entry' || item.kind === currentKind) {
        continue;
      }
      watchFileKinds.set(
        item.file,
        item.kind === 'entry' ? 'entry' : (currentKind ?? item.kind),
      );
    }
  }

  return {
    code: results
      .map((result) => result.code)
      .filter((code) => code.trim())
      .join('\n'),

    watchFiles: Array.from(
      new Set(results.flatMap((result) => result.watchFiles)),
    ),

    cacheInputFiles: Array.from(
      new Set(results.flatMap((result) => result.cacheInputFiles ?? [])),
    ),

    dependencyPackages: Array.from(
      new Set(results.flatMap((result) => result.dependencyPackages ?? [])),
    ),

    watchFileKinds: Array.from(watchFileKinds, ([file, kind]) => ({
      file,
      kind,
    })),
  };
}
