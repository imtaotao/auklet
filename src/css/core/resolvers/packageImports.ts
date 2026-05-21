import fs from 'node:fs';
import path from 'node:path';
import { findPathInImports, type Imports } from 'conditional-export';
import { POSIX_SEPARATOR, toPosixPath } from '#auklet/utils';

type PackageJsonWithImports = {
  imports?: Imports;
};

const conditions = ['source', 'import', 'default'];
const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;

const readPackageImports = (packageRoot: string) => {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return {};

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8'),
    ) as PackageJsonWithImports;
    return packageJson.imports ?? {};
  } catch {
    return {};
  }
};

const trimSourceExtension = (value: string) => {
  return value.replace(sourceExtensions, '');
};

const toSourceRelativePath = (
  packageRoot: string,
  sourceRoot: string,
  target: string,
) => {
  if (!target.startsWith('.')) return null;

  const file = path.resolve(packageRoot, target);
  const relative = path.relative(sourceRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return trimSourceExtension(toPosixPath(relative));
};

export function resolvePackageImportsSourceImport(
  packageRoot: string,
  sourceRoot: string,
  importPath: string,
) {
  if (!importPath.startsWith('#')) return [];

  const resolved = (() => {
    try {
      return findPathInImports(
        importPath,
        readPackageImports(packageRoot),
        conditions,
      );
    } catch {
      return null;
    }
  })();
  if (!resolved) return [];

  const sourceRelativePath = toSourceRelativePath(
    packageRoot,
    sourceRoot,
    resolved,
  );
  return sourceRelativePath
    ? [sourceRelativePath.split(POSIX_SEPARATOR).join(path.sep)]
    : [];
}
