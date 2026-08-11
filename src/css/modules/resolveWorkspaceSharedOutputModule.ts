import fs from 'node:fs';
import path from 'node:path';
import { findPathInExports, parseModuleId } from 'conditional-export';
import { normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { isExternalPackageSpecifier } from '#auklet/css/core/resolvers/externalLess';
import {
  isCssModuleSpecifier,
  isPlainStyleSpecifier,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import {
  findDependencyPackageRoot,
  isDirectDependency,
  isWorkspaceEditablePackageRoot,
  listDirectDependencyPackageNames,
  readPackageJson,
  STYLE_PACKAGE_EXPORT_CONDITIONS,
} from '#auklet/css/core/resolvers/packageDependency';
import {
  clearSharedOutputResolveCache,
  getSharedOutputResolveCache,
  isPublishedPlainSharedOutputAssetTarget,
  listSharedOutputFiles,
  setSharedOutputResolveCache,
  type SharedOutputResolveCacheEntry,
} from '#auklet/css/core/style/sharedOutput';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { normalizeFileKey } from '#auklet/utils';

export type ResolveWorkspaceSharedOutputModuleOptions = {
  source: string;
  importerPackageRoot: string;
  loadAukletConfig?: typeof loadAukletConfig;
};

export function invalidateWorkspaceSharedOutputResolveCache(
  packageRoot?: string,
) {
  clearSharedOutputResolveCache(packageRoot);
}

const isPublishedModulesShimTarget = (target: string) =>
  /\.module\.(?:css|less)\.js$/i.test(target);

// Workspace-editable direct deps (symlink / workspace path), not installed copies.
export function listWorkspaceEditableDependencyPackageRoots(
  importerPackageRoot: string,
) {
  const roots: Array<string> = [];
  for (const packageName of listDirectDependencyPackageNames(
    importerPackageRoot,
  )) {
    const packageRoot = findDependencyPackageRoot(
      importerPackageRoot,
      packageName,
    );
    if (!packageRoot || !isWorkspaceEditablePackageRoot(packageRoot)) continue;
    roots.push(packageRoot);
  }
  return roots;
}

// Dev pre-warm so sync Less (reference) remap does not depend on a prior JS
// import of shared.output. loadProducerSharedOutputCache is a no-op-ish miss
// when styles.shared.output is empty (empty plain list → no remap).
export async function warmWorkspaceSharedOutputCaches(options: {
  packageRoots: Iterable<string>;
  loadAukletConfig?: typeof loadAukletConfig;
}) {
  const loadConfig = options.loadAukletConfig ?? loadAukletConfig;
  const roots = new Set<string>();
  for (const packageRoot of options.packageRoots) {
    const resolved = path.resolve(packageRoot);
    if (!isWorkspaceEditablePackageRoot(resolved)) continue;
    roots.add(resolved);
  }
  await Promise.all(
    Array.from(roots, (packageRoot) =>
      loadProducerSharedOutputCache(packageRoot, loadConfig),
    ),
  );
}

export async function loadProducerSharedOutputCache(
  packageRoot: string,
  loadConfig: typeof loadAukletConfig = loadAukletConfig,
) {
  const hit = getSharedOutputResolveCache(packageRoot);
  if (hit) return hit;

  // Miss must cacheBust so Node ESM does not keep a stale auklet.config.* module.
  const normalizedConfig = normalizeAukletConfig(
    await loadConfig(packageRoot, { cacheBust: true }),
  );
  const sourceRoot = path.join(packageRoot, normalizedConfig.source);
  const outputDir = normalizedConfig.output;
  const outputFormats = moduleStyleBuildConfig.output.outputFormats;
  const moduleFileKeys = new Set<string>();
  const plainFileKeys = new Set<string>();
  if (normalizedConfig.styles.shared.output.length) {
    for (const file of listSharedOutputFiles({
      packageRoot,
      sourceRoot,
      patterns: normalizedConfig.styles.shared.output,
    })) {
      const key = normalizeFileKey(file);
      if (isCssModuleFile(file)) {
        moduleFileKeys.add(key);
      } else {
        plainFileKeys.add(key);
      }
    }
  }

  const entry = {
    sourceRoot,
    outputDir,
    outputFormats,
    moduleFileKeys,
    plainFileKeys,
  } satisfies SharedOutputResolveCacheEntry;
  setSharedOutputResolveCache(packageRoot, entry);
  return entry;
}

const resolveWorkspaceSharedOutputPackage = (options: {
  source: string;
  importerPackageRoot: string;
}) => {
  const source = options.source.split('?', 1)[0] ?? options.source;
  if (!isExternalPackageSpecifier(source)) return null;

  const parsed = (() => {
    try {
      return parseModuleId(source);
    } catch {
      return null;
    }
  })();
  if (!parsed) return null;

  const importerPackageJson = readPackageJson(
    path.join(options.importerPackageRoot, 'package.json'),
  );
  if (
    !importerPackageJson ||
    !isDirectDependency(parsed.name, importerPackageJson)
  ) {
    return null;
  }

  const packageRoot = findDependencyPackageRoot(
    options.importerPackageRoot,
    parsed.name,
  );
  if (!packageRoot || !isWorkspaceEditablePackageRoot(packageRoot)) {
    return null;
  }

  const packageJson = readPackageJson(path.join(packageRoot, 'package.json'));
  if (
    !packageJson?.name ||
    packageJson.name !== parsed.name ||
    !packageJson.exports
  ) {
    return null;
  }

  const exportTarget = (() => {
    try {
      return findPathInExports(
        parsed.path || '.',
        packageJson.exports!,
        STYLE_PACKAGE_EXPORT_CONDITIONS,
      );
    } catch {
      return null;
    }
  })();
  if (!exportTarget) return null;

  const relative = (parsed.path || '.').replace(/^\.\//, '');
  if (!relative || relative === '.') return null;

  return {
    packageRoot,
    exportTarget,
    relative,
  };
};

// Dev-only: workspace producer shared.output Modules → source for HMR.
export async function resolveWorkspaceSharedOutputModule(
  options: ResolveWorkspaceSharedOutputModuleOptions,
) {
  const source = options.source.split('?', 1)[0] ?? options.source;
  if (!isExternalPackageSpecifier(source) || !isCssModuleSpecifier(source)) {
    return null;
  }

  const resolved = resolveWorkspaceSharedOutputPackage({
    source,
    importerPackageRoot: options.importerPackageRoot,
  });
  if (!resolved || !isPublishedModulesShimTarget(resolved.exportTarget)) {
    return null;
  }
  if (!isCssModuleFile(resolved.relative)) return null;

  const loadConfig = options.loadAukletConfig ?? loadAukletConfig;
  const { sourceRoot, moduleFileKeys } = await loadProducerSharedOutputCache(
    resolved.packageRoot,
    loadConfig,
  );
  const candidate = path.resolve(sourceRoot, resolved.relative);
  if (!isCssModuleFile(candidate) || !fs.existsSync(candidate)) {
    return null;
  }

  return moduleFileKeys.has(normalizeFileKey(candidate)) ? candidate : null;
}

// Dev-only: workspace producer shared.output plain css/less → source.
export async function resolveWorkspaceSharedOutputPlainStyle(
  options: ResolveWorkspaceSharedOutputModuleOptions,
) {
  const source = options.source.split('?', 1)[0] ?? options.source;
  if (!isExternalPackageSpecifier(source) || !isPlainStyleSpecifier(source)) {
    return null;
  }

  const resolved = resolveWorkspaceSharedOutputPackage({
    source,
    importerPackageRoot: options.importerPackageRoot,
  });
  if (!resolved) return null;

  const loadConfig = options.loadAukletConfig ?? loadAukletConfig;
  const cache = await loadProducerSharedOutputCache(
    resolved.packageRoot,
    loadConfig,
  );
  if (
    !isPublishedPlainSharedOutputAssetTarget(resolved.exportTarget, {
      outputDir: cache.outputDir,
      outputFormats: cache.outputFormats,
    })
  ) {
    return null;
  }

  // Mirror export subpath under producer sourceRoot (not the published path).
  const candidate = path.resolve(cache.sourceRoot, resolved.relative);
  if (!fs.existsSync(candidate)) return null;
  if (!cache.plainFileKeys.has(normalizeFileKey(candidate))) return null;
  return candidate;
}
