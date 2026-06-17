import fs from 'node:fs';
import path from 'node:path';
import type { PackageStyleContext } from '#auklet/css/vite/moduleGraph/requestCache';
import { normalizeFileKey, toFsSpecifier } from '#auklet/utils';

const getPackageName = (specifier: string) => {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const [scope, name] = specifier.split('/');
  return `${scope}/${name}`;
};

const findPackageJson = (
  file: string,
  context: PackageStyleContext,
  specifier: string,
) => {
  let current = path.dirname(file);
  let currentKey = normalizeFileKey(current);
  const packageRootKey = normalizeFileKey(context.context.packageRoot);

  while (
    currentKey === packageRootKey ||
    currentKey.startsWith(`${packageRootKey}/`)
  ) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) return packageJson;
    if (currentKey === packageRootKey) break;
    current = path.dirname(current);
    currentKey = normalizeFileKey(current);
  }

  return path.join(
    context.context.packageRoot,
    'node_modules',
    getPackageName(specifier),
    'package.json',
  );
};

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
    cacheInputFiles: [findPackageJson(resolved, context, specifier)],
    specifier: toFsSpecifier(resolved),
    watchFile: resolved,
  };
}
