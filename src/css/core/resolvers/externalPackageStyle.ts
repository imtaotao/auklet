import fs from 'node:fs';
import path from 'node:path';
import { findPathInExports, parseModuleId } from 'conditional-export';
import {
  assertExternalLessSupportsSpecifier,
  ExternalLessResolutionError,
  findPackageRootForFile,
  readPackageName,
} from '#auklet/css/core/resolvers/externalLess';
import {
  findDependencyPackageRoot,
  isDirectDependency,
  readPackageJson,
  STYLE_PACKAGE_EXPORT_CONDITIONS,
} from '#auklet/css/core/resolvers/packageDependency';
import { matchesTsconfigPathsAlias } from '#auklet/css/core/resolvers/tsconfigPaths';
import { isInsideRoot } from '#auklet/utils';

export type ExternalPackageStyleResolution = {
  file: string;
  packageName: string;
  packageRoot: string;
  packageJsonFile: string;
};

export type ResolveExternalPackageStyleOptions = {
  extensions: Array<string>;
  conditions?: Array<string>;
};

const assertDirectDependency = (
  packageName: string,
  importerPackageRoot: string,
) => {
  const packageJsonFile = path.join(importerPackageRoot, 'package.json');
  const packageJson = readPackageJson(packageJsonFile);
  if (packageJson?.name === packageName) {
    throw new ExternalLessResolutionError(
      'unsupported-self-import',
      `[css] external package style imports cannot target the importing package itself: ${packageName}. Use a relative path instead.`,
    );
  }
  if (packageJson && isDirectDependency(packageName, packageJson)) return;
  throw new ExternalLessResolutionError(
    'not-direct-dependency',
    `[css] external package style must be a direct dependency: ${packageName} from ${packageJsonFile}`,
  );
};

export const matchesStyleFileExtension = (
  file: string,
  extensions: Array<string>,
) => {
  const lower = file.toLowerCase();
  return extensions.some((extension) =>
    lower.endsWith(extension.toLowerCase()),
  );
};

export const isCssModuleSpecifier = (specifier: string) =>
  matchesStyleFileExtension(specifier, ['.module.css', '.module.less']);

export const isPlainStyleSpecifier = (specifier: string) =>
  matchesStyleFileExtension(specifier, ['.css', '.less']) &&
  !isCssModuleSpecifier(specifier);

export function resolveStyleSourceRootForFile(options: {
  file: string;
  packageRoot?: string | null;
  configuredSourceRoot?: string | null;
}) {
  const packageRoot =
    options.packageRoot ?? findPackageRootForFile(options.file);
  if (!packageRoot) return null;
  if (
    options.configuredSourceRoot &&
    isInsideRoot(options.file, options.configuredSourceRoot)
  ) {
    return path.resolve(options.configuredSourceRoot);
  }
  return path.resolve(packageRoot);
}

export function resolveExternalPackageStyleImport(
  specifier: string,
  importerPackageRoot: string,
  options: ResolveExternalPackageStyleOptions,
) {
  assertExternalLessSupportsSpecifier(specifier);
  if (matchesTsconfigPathsAlias(importerPackageRoot, specifier)) {
    throw new ExternalLessResolutionError(
      'unsupported-alias',
      `[css] external package style imports do not support tsconfig paths: ${specifier}`,
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
      `[css] invalid external package style import: ${specifier}`,
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
      `[css] external package style package not found: ${parsed.name} from ${importerPackageRoot}`,
    );
  }

  const packageJsonFile = path.join(packageRoot, 'package.json');
  const packageJson = readPackageJson(packageJsonFile);
  if (!packageJson?.name || packageJson.name !== parsed.name) {
    throw new ExternalLessResolutionError(
      'package-name-mismatch',
      `[css] external package style name must match the import/dependency name: ${parsed.name} -> ${packageJson?.name ?? '(missing)'} from ${importerPackageRoot}`,
    );
  }
  if (!packageJson.exports) {
    throw new ExternalLessResolutionError(
      'exports-required',
      `[css] external package style package must define exports: ${parsed.name} from ${importerPackageRoot}`,
    );
  }

  const conditions = options.conditions ?? STYLE_PACKAGE_EXPORT_CONDITIONS;
  const target = (() => {
    try {
      return findPathInExports(
        parsed.path || '.',
        packageJson.exports!,
        conditions,
      );
    } catch {
      return null;
    }
  })();
  if (!target) {
    throw new ExternalLessResolutionError(
      'subpath-not-exported',
      `[css] external package style import is not exported: ${specifier} from ${importerPackageRoot}`,
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
    !matchesStyleFileExtension(realFile, options.extensions) ||
    !fs.statSync(realFile).isFile()
  ) {
    const expected = options.extensions.join(' | ');
    throw new ExternalLessResolutionError(
      'invalid-export-target',
      `[css] external package style export must resolve to a published style file (${expected}) inside its package: ${specifier} -> ${target}`,
    );
  }

  return {
    file: realFile,
    packageName: packageJson.name,
    packageRoot,
    packageJsonFile,
  } satisfies ExternalPackageStyleResolution;
}

export { findPackageRootForFile, readPackageName };
