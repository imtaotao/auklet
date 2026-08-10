import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  findPathInExports,
  parseModuleId,
  type Exports,
} from 'conditional-export';
import { matchesTsconfigPathsAlias } from '#auklet/css/core/resolvers/tsconfigPaths';
import { isInsideRoot } from '#auklet/utils';

const LESS_EXPORT_CONDITIONS = ['less', 'source', 'import', 'default'];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type PackageJson = {
  name?: string;
  exports?: Exports;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type ExternalLessResolution = {
  file: string;
  packageName: string;
  packageRoot: string;
  packageJsonFile: string;
};

export type ExternalLessResolutionErrorCode =
  | 'invalid-specifier'
  | 'unsupported-alias'
  | 'unsupported-self-import'
  | 'not-direct-dependency'
  | 'package-not-found'
  | 'package-name-mismatch'
  | 'exports-required'
  | 'subpath-not-exported'
  | 'invalid-export-target';

export class ExternalLessResolutionError extends Error {
  constructor(
    readonly code: ExternalLessResolutionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const isExternalPackageSpecifier = (specifier: string) =>
  !specifier.startsWith('.') &&
  !specifier.startsWith('/') &&
  !specifier.startsWith('#');

export function assertExternalLessSupportsSpecifier(specifier: string) {
  if (!specifier.startsWith('#')) return;
  throw new ExternalLessResolutionError(
    'unsupported-alias',
    `[css] external Less imports do not support package.json#imports: ${specifier}`,
  );
}

/** `#…` CSS imports may pass through Less emit into the CSS pipeline. */
export function isRejectedPackageImportsLessSpecifier(
  specifier: string,
  options: string | null,
) {
  if (!specifier.startsWith('#')) return false;
  if (specifier.toLowerCase().endsWith('.less')) return true;
  if (!options) return false;
  return options
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes('reference');
}

const readPackageJson = (packageJsonFile: string) => {
  try {
    return JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
};

export const findPackageRootForFile = (file: string) => {
  let current = path.extname(file) ? path.dirname(file) : path.resolve(file);
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    current = path.dirname(current);
  }
  return null;
};

export function resolveImporterPackageRoot(options: {
  packageRoot?: string;
  sourceRoot?: string;
  file?: string;
}) {
  if (options.packageRoot) return path.resolve(options.packageRoot);
  const anchor = options.sourceRoot ?? options.file;
  if (!anchor) return null;
  return path.resolve(findPackageRootForFile(anchor) ?? path.dirname(anchor));
}

export function readPackageName(packageRoot: string) {
  return readPackageJson(path.join(packageRoot, 'package.json'))?.name ?? null;
}

const findDependencyPackageRoot = (
  importerPackageRoot: string,
  packageName: string,
) => {
  const require = createRequire(path.join(importerPackageRoot, 'package.json'));
  for (const searchPath of require.resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchPath, packageName);
    const packageJsonFile = path.join(candidate, 'package.json');
    if (!fs.existsSync(packageJsonFile)) continue;
    return fs.realpathSync.native(candidate);
  }
  return null;
};

export function collectExternalLessPackageJsonCandidates(
  importerPackageRoot: string,
  packageName: string,
) {
  const candidates = new Set<string>();
  const require = createRequire(path.join(importerPackageRoot, 'package.json'));
  for (const searchPath of require.resolve.paths(packageName) ?? []) {
    candidates.add(
      path.resolve(path.join(searchPath, packageName, 'package.json')),
    );
  }
  candidates.add(
    path.resolve(
      path.join(
        importerPackageRoot,
        'node_modules',
        packageName,
        'package.json',
      ),
    ),
  );
  return Array.from(candidates);
}

const assertDirectDependency = (
  packageName: string,
  importerPackageRoot: string,
) => {
  const packageJsonFile = path.join(importerPackageRoot, 'package.json');
  const packageJson = readPackageJson(packageJsonFile);
  if (packageJson?.name === packageName) {
    throw new ExternalLessResolutionError(
      'unsupported-self-import',
      `[css] external Less imports cannot target the importing package itself: ${packageName}. Use a relative path instead.`,
    );
  }
  const declared = DEPENDENCY_FIELDS.some((field) =>
    Object.hasOwn(packageJson?.[field] ?? {}, packageName),
  );
  if (declared) return;
  throw new ExternalLessResolutionError(
    'not-direct-dependency',
    `[css] external Less package must be a direct dependency: ${packageName} from ${packageJsonFile}`,
  );
};

export const resolveExternalLessImport = (
  specifier: string,
  importerPackageRoot: string,
) => {
  assertExternalLessSupportsSpecifier(specifier);
  if (matchesTsconfigPathsAlias(importerPackageRoot, specifier)) {
    throw new ExternalLessResolutionError(
      'unsupported-alias',
      `[css] external Less imports do not support tsconfig paths: ${specifier}`,
    );
  }

  const parsed = (() => {
    try {
      return parseModuleId(specifier);
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    throw new ExternalLessResolutionError(
      'invalid-specifier',
      `[css] invalid external Less import: ${specifier}`,
    );
  }

  assertDirectDependency(parsed.name, importerPackageRoot);
  const packageRoot = findDependencyPackageRoot(
    importerPackageRoot,
    parsed.name,
  );
  if (!packageRoot) {
    throw new ExternalLessResolutionError(
      'package-not-found',
      `[css] external Less package not found: ${parsed.name} from ${importerPackageRoot}`,
    );
  }

  const packageJsonFile = path.join(packageRoot, 'package.json');
  const packageJson = readPackageJson(packageJsonFile);
  if (!packageJson?.name || packageJson.name !== parsed.name) {
    throw new ExternalLessResolutionError(
      'package-name-mismatch',
      `[css] external Less package name must match the import/dependency name: ${parsed.name} -> ${packageJson?.name ?? '(missing)'} from ${importerPackageRoot}`,
    );
  }
  if (!packageJson.exports) {
    throw new ExternalLessResolutionError(
      'exports-required',
      `[css] external Less package must define exports: ${parsed.name} from ${importerPackageRoot}`,
    );
  }

  const target = (() => {
    try {
      return findPathInExports(
        parsed.path || '.',
        packageJson.exports!,
        LESS_EXPORT_CONDITIONS,
      );
    } catch {
      return null;
    }
  })();
  if (!target) {
    throw new ExternalLessResolutionError(
      'subpath-not-exported',
      `[css] external Less import is not exported: ${specifier} from ${importerPackageRoot}`,
    );
  }

  const file = path.resolve(packageRoot, target);
  const realFile =
    fs.existsSync(file) && target.startsWith('./')
      ? fs.realpathSync.native(file)
      : null;
  if (
    !target.startsWith('./') ||
    !isInsideRoot(file, packageRoot) ||
    !realFile ||
    !isInsideRoot(realFile, packageRoot) ||
    path.extname(file).toLowerCase() !== '.less' ||
    path.extname(realFile).toLowerCase() !== '.less' ||
    !fs.statSync(realFile).isFile()
  ) {
    throw new ExternalLessResolutionError(
      'invalid-export-target',
      `[css] external Less export must resolve to a published .less file inside its package: ${specifier} -> ${target}`,
    );
  }

  return {
    file: realFile,
    packageName: packageJson.name,
    packageRoot,
    packageJsonFile,
  } satisfies ExternalLessResolution;
};
