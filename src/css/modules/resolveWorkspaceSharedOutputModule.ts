import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findPathInExports, parseModuleId } from 'conditional-export';
import { normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { isExternalPackageSpecifier } from '#auklet/css/core/resolvers/externalLess';
import { isCssModuleSpecifier } from '#auklet/css/core/resolvers/externalPackageStyle';
import { listSharedOutputModuleFiles } from '#auklet/css/core/style/sharedOutput';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { isInstalledNodeModulesPath, normalizeFileKey } from '#auklet/utils';

export type ResolveWorkspaceSharedOutputModuleOptions = {
  source: string;
  importerPackageRoot: string;
  loadAukletConfig?: typeof loadAukletConfig;
};

type ProducerSharedOutputCacheEntry = {
  sourceRoot: string;
  sharedFileKeys: Set<string>;
};

const STYLE_EXPORT_CONDITIONS = [
  'less',
  'source',
  'style',
  'import',
  'default',
];

// Process-local only. Invalidate when producer auklet.config.* changes.
const producerSharedOutputCache = new Map<
  string,
  ProducerSharedOutputCacheEntry
>();

export function invalidateWorkspaceSharedOutputResolveCache(
  packageRoot?: string,
) {
  if (packageRoot == null) {
    producerSharedOutputCache.clear();
    return;
  }
  producerSharedOutputCache.delete(normalizeFileKey(packageRoot));
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

const readPackageJson = (packageJsonFile: string) => {
  try {
    return JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')) as {
      name?: string;
      exports?: Parameters<typeof findPathInExports>[1];
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
};

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

const isDirectDependency = (
  packageName: string,
  packageJson: NonNullable<ReturnType<typeof readPackageJson>>,
) =>
  DEPENDENCY_FIELDS.some((field) =>
    Object.hasOwn(packageJson[field] ?? {}, packageName),
  );

const isWorkspaceEditablePackageRoot = (packageRoot: string) =>
  !isInstalledNodeModulesPath(packageRoot);

const isPublishedModulesShimTarget = (target: string) =>
  /\.module\.(?:css|less)\.js$/i.test(target);

const loadProducerSharedOutputCache = async (
  packageRoot: string,
  loadConfig: typeof loadAukletConfig,
) => {
  const cacheKey = normalizeFileKey(packageRoot);
  const hit = producerSharedOutputCache.get(cacheKey);
  if (hit) return hit;

  // Miss must cacheBust so Node ESM does not keep a stale auklet.config.* module.
  const normalizedConfig = normalizeAukletConfig(
    await loadConfig(packageRoot, { cacheBust: true }),
  );
  const sourceRoot = path.join(packageRoot, normalizedConfig.source);
  const sharedFileKeys = new Set<string>();
  if (
    normalizedConfig.modules &&
    normalizedConfig.styles.shared.output.length
  ) {
    for (const file of listSharedOutputModuleFiles({
      packageRoot,
      sourceRoot,
      patterns: normalizedConfig.styles.shared.output,
    })) {
      sharedFileKeys.add(normalizeFileKey(file));
    }
  }

  const entry = { sourceRoot, sharedFileKeys };
  producerSharedOutputCache.set(cacheKey, entry);
  return entry;
};

// Dev-only: workspace producer shared.output → source file for Modules HMR.
// Installed packages keep the published JS shim. Dist shim need not be fresh.
export async function resolveWorkspaceSharedOutputModule(
  options: ResolveWorkspaceSharedOutputModuleOptions,
) {
  const source = options.source.split('?', 1)[0] ?? options.source;
  if (!isExternalPackageSpecifier(source) || !isCssModuleSpecifier(source)) {
    return null;
  }

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
        STYLE_EXPORT_CONDITIONS,
      );
    } catch {
      return null;
    }
  })();
  if (!exportTarget || !isPublishedModulesShimTarget(exportTarget)) {
    return null;
  }

  const relative = (parsed.path || '.').replace(/^\.\//, '');
  if (!relative || relative === '.' || !isCssModuleFile(relative)) {
    return null;
  }

  const loadConfig = options.loadAukletConfig ?? loadAukletConfig;
  const { sourceRoot, sharedFileKeys } = await loadProducerSharedOutputCache(
    packageRoot,
    loadConfig,
  );
  const candidate = path.resolve(sourceRoot, relative);
  if (!isCssModuleFile(candidate) || !fs.existsSync(candidate)) {
    return null;
  }

  return sharedFileKeys.has(normalizeFileKey(candidate)) ? candidate : null;
}
