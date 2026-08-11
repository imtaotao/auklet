import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Exports } from 'conditional-export';
import { isInstalledNodeModulesPath } from '#auklet/utils';

export const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type PackageDependencyJson = {
  name?: string;
  exports?: Exports;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

// Shared style export condition order for package css/less (Less-only resolvers
// may use a narrower list without `style`).
export const STYLE_PACKAGE_EXPORT_CONDITIONS = [
  'less',
  'source',
  'style',
  'import',
  'default',
];

export function readPackageJson(packageJsonFile: string) {
  try {
    return JSON.parse(
      fs.readFileSync(packageJsonFile, 'utf8'),
    ) as PackageDependencyJson;
  } catch {
    return null;
  }
}

// Node resolution roots for `packageName` from the importer (createRequire paths).
export function listDependencyPackageSearchRoots(
  importerPackageRoot: string,
  packageName: string,
) {
  const require = createRequire(path.join(importerPackageRoot, 'package.json'));
  const roots: Array<string> = [];
  for (const searchPath of require.resolve.paths(packageName) ?? []) {
    roots.push(path.resolve(path.join(searchPath, packageName)));
  }
  return roots;
}

export function findDependencyPackageRoot(
  importerPackageRoot: string,
  packageName: string,
) {
  for (const candidate of listDependencyPackageSearchRoots(
    importerPackageRoot,
    packageName,
  )) {
    if (!fs.existsSync(path.join(candidate, 'package.json'))) continue;
    return fs.realpathSync.native(candidate);
  }
  return null;
}

// package.json candidates for watch / optional resolution (may not exist yet).
export function listDependencyPackageJsonCandidates(
  importerPackageRoot: string,
  packageName: string,
) {
  const candidates = new Set<string>();
  for (const root of listDependencyPackageSearchRoots(
    importerPackageRoot,
    packageName,
  )) {
    candidates.add(path.join(root, 'package.json'));
  }
  candidates.add(
    path.resolve(
      importerPackageRoot,
      'node_modules',
      packageName,
      'package.json',
    ),
  );
  return Array.from(candidates);
}

export function isDirectDependency(
  packageName: string,
  packageJson: PackageDependencyJson,
) {
  return PACKAGE_DEPENDENCY_FIELDS.some((field) =>
    Object.hasOwn(packageJson[field] ?? {}, packageName),
  );
}

export function isDeclaredDirectDependency(
  packageName: string,
  importerPackageRoot: string,
) {
  const packageJson = readPackageJson(
    path.join(importerPackageRoot, 'package.json'),
  );
  if (!packageJson) return false;
  return isDirectDependency(packageName, packageJson);
}

export function listDirectDependencyPackageNames(packageRoot: string) {
  const packageJson = readPackageJson(path.join(packageRoot, 'package.json'));
  if (!packageJson) return [] as Array<string>;
  const names = new Set<string>();
  for (const field of PACKAGE_DEPENDENCY_FIELDS) {
    for (const name of Object.keys(packageJson[field] ?? {})) {
      names.add(name);
    }
  }
  return Array.from(names);
}

export function isWorkspaceEditablePackageRoot(packageRoot: string) {
  return !isInstalledNodeModulesPath(packageRoot);
}
