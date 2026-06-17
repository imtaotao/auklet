import fs from 'node:fs';
import path from 'node:path';
import { toFsSpecifier } from '#auklet/utils';
import type { PackageStyleContext } from '#auklet/css/vite/moduleGraph/requestCache';

const getPackageName = (specifier: string) => {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const [scope, name] = specifier.split('/');
  if (!scope || !name) return null;
  return `${scope}/${name}`;
};

const findNodeModulesPackageRoot = (file: string, packageName: string) => {
  const resolved = path.resolve(file);
  const root = path.parse(resolved).root;
  const parts = path.relative(root, resolved).split(path.sep);
  const packageParts = packageName.split('/');
  const packageLength = packageParts.length;

  for (let index = parts.length - packageLength - 1; index >= 0; index -= 1) {
    if (parts[index] !== 'node_modules') continue;
    const candidateParts = parts.slice(index + 1, index + 1 + packageLength);
    if (candidateParts.join('/') !== packageName) continue;
    return path.join(root, ...parts.slice(0, index + 1 + packageLength));
  }
  return null;
};

const findPackageJson = (
  file: string,
  context: PackageStyleContext,
  specifier: string,
) => {
  const packageName = getPackageName(specifier);
  if (!packageName) return null;
  const packageRoot = findNodeModulesPackageRoot(file, packageName);
  if (!packageRoot) {
    return path.join(
      context.context.packageRoot,
      'node_modules',
      packageName,
      'package.json',
    );
  }

  let current = path.dirname(file);
  let next = current;
  const packageRootKey = path.resolve(packageRoot);

  do {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) return packageJson;
    if (path.resolve(current) === packageRootKey) break;
    next = path.dirname(current);
    if (next !== current) current = next;
  } while (next !== current);

  return path.join(
    context.context.packageRoot,
    'node_modules',
    packageName,
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
  const packageJson = findPackageJson(resolved, context, specifier);
  return {
    cacheInputFiles: packageJson ? [packageJson] : [],
    specifier: toFsSpecifier(resolved),
    watchFile: resolved,
  };
}
