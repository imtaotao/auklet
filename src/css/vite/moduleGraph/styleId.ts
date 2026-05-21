import type { PackageStyleId } from '#auklet/css/vite/moduleGraph/types';

// 根据已知 workspace 包名解析 package CSS id，并优先匹配最长包名。
export function parsePackageStyleId(id: string, packageNames: Array<string>) {
  if (!id.endsWith('.css')) {
    return null;
  }

  const packageName = [...packageNames]
    .sort((left, right) => right.length - left.length)
    .find((name) => id.startsWith(`${name}/`));
  if (!packageName) return null;

  return {
    packageName,
    stylePath: id.slice(packageName.length + 1),
  } satisfies PackageStyleId;
}
