import type { PackageStyleContext } from '#auklet/css/vite/moduleGraph/requestCache';
import { toFsSpecifier } from '#auklet/utils';

// 在 Vite 虚拟 CSS 中，第三方 CSS 依赖要用声明它的包作为解析根。
export function toDevDependencyImportSpecifier(
  context: PackageStyleContext,
  specifier: string,
) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return { specifier };
  }
  const resolved = context.resolver.resolveStyleDependency(specifier);
  return {
    specifier: toFsSpecifier(resolved),
    watchFile: resolved,
  };
}
