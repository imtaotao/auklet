import type { PackageStyleLoadResult } from '#auklet/css/vite/moduleGraph/types';

// 合并递归 style graph 加载结果，同时保留 CSS 顺序并去重 watch files。
export function mergeLoadResults(...results: Array<PackageStyleLoadResult>) {
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
  };
}
