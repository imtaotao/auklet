import fs from 'node:fs';
import path from 'node:path';
import { findPathInExports, type Exports } from 'conditional-export';
import { STYLE_PACKAGE_EXPORT_CONDITIONS } from '#auklet/css/core/resolvers/packageDependency';
import { resolveSharedStylePatterns } from '#auklet/css/core/style/shared';
import {
  COMPILED_CSS_MODULE_SCOPED_SUFFIX,
  isCompiledCssModuleScopedCssFile,
  toCompiledCssModuleAssetRelative,
} from '#auklet/css/modules/cssModuleOutputPaths';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  isInstalledNodeModulesPath,
  normalizeFileKey,
  toPosixPath,
} from '#auklet/utils';
import type { NormalizedAukletConfig } from '#auklet/types';

const MODULE_JS_SUFFIX = '.js';
// Alias of the compiled Modules CSS suffix (same contract as JS build emit).
export const SHARED_OUTPUT_SCOPED_CSS_SUFFIX =
  COMPILED_CSS_MODULE_SCOPED_SUFFIX;

const PLAIN_STYLE_EXTENSIONS = new Set(['.css', '.less']);

export type SharedOutputEntryKind = 'module' | 'css' | 'less';

export type SharedOutputEntry = {
  kind: SharedOutputEntryKind;
  sourceFile: string;
  sourceRelative: string;
  exportSubpath: string;
  // Modules: *.scoped.css; plain: same as sourceRelative.
  assetRelative: string;
  jsRelative: string | null;
  assetFiles: Array<string>;
  jsFiles: Array<string>;
};

export type SharedOutputExportCheck = {
  exportSubpath: string;
  exportTarget: string | null;
  expectedTargetRelative: string;
  ok: boolean;
  reason?: string;
};

const getSharedOutputEntryKind = (file: string) => {
  if (isCssModuleFile(file)) return 'module' as const;
  const ext = path.extname(file).toLowerCase();
  if (ext === '.css') return 'css' as const;
  if (ext === '.less') return 'less' as const;
  return null;
};

export function listSharedOutputFiles(options: {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
}) {
  const matched = resolveSharedStylePatterns(options);
  const supported: Array<string> = [];
  const unsupported: Array<string> = [];
  for (const file of matched) {
    if (getSharedOutputEntryKind(file)) {
      supported.push(file);
    } else {
      unsupported.push(file);
    }
  }
  if (unsupported.length) {
    throw new Error(
      `[css] styles.shared.output must match CSS Modules (*.module.css|*.module.less) or plain .css/.less: ${unsupported
        .slice(0, 3)
        .map((file) => toPosixPath(path.relative(options.packageRoot, file)))
        .join(', ')}`,
    );
  }
  return supported;
}

// CSS Modules plugin / Modules-only consumers still need the module subset.
export function listSharedOutputModuleFiles(options: {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
}) {
  return listSharedOutputFiles(options).filter((file) => isCssModuleFile(file));
}

export function sharedOutputRequiresModules(options: {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
}) {
  return listSharedOutputModuleFiles(options).length > 0;
}

export function toSharedOutputCssRelative(sourceRelative: string) {
  return toCompiledCssModuleAssetRelative(sourceRelative);
}

export function toSharedOutputJsRelative(sourceRelative: string) {
  return `${toPosixPath(sourceRelative)}${MODULE_JS_SUFFIX}`;
}

export function isSharedOutputScopedCssFile(file: string) {
  return isCompiledCssModuleScopedCssFile(file);
}

export function isPlainSharedOutputStyleFile(file: string) {
  if (isCssModuleFile(file)) return false;
  return PLAIN_STYLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export function createSharedOutputEntries(options: {
  packageRoot: string;
  sourceRoot: string;
  outputDir: string;
  outputFormats: Array<string>;
  patterns: Array<string>;
}) {
  const files = listSharedOutputFiles(options);
  return files.map((sourceFile) => {
    const kind = getSharedOutputEntryKind(sourceFile)!;
    const sourceRelative = toPosixPath(
      path.relative(options.sourceRoot, sourceFile),
    );
    if (kind === 'module') {
      const assetRelative = toSharedOutputCssRelative(sourceRelative);
      const jsRelative = toSharedOutputJsRelative(sourceRelative);
      const assetFiles = options.outputFormats.map((format) =>
        toPosixPath(path.join(options.outputDir, format, assetRelative)),
      );
      const jsFiles = options.outputFormats.map((format) =>
        toPosixPath(path.join(options.outputDir, format, jsRelative)),
      );
      return {
        kind,
        sourceFile,
        sourceRelative,
        exportSubpath: `./${sourceRelative}`,
        assetRelative,
        jsRelative,
        assetFiles,
        jsFiles,
      } satisfies SharedOutputEntry;
    }

    const assetRelative = sourceRelative;
    const assetFiles = options.outputFormats.map((format) =>
      toPosixPath(path.join(options.outputDir, format, assetRelative)),
    );
    return {
      kind,
      sourceFile,
      sourceRelative,
      exportSubpath: `./${sourceRelative}`,
      assetRelative,
      jsRelative: null,
      assetFiles,
      jsFiles: [],
    } satisfies SharedOutputEntry;
  });
}

export function createSharedOutputEntriesFromConfig(options: {
  packageRoot: string;
  normalizedConfig: NormalizedAukletConfig;
  outputFormats: Array<string>;
}) {
  const sourceRoot = path.join(
    options.packageRoot,
    options.normalizedConfig.source,
  );
  return createSharedOutputEntries({
    packageRoot: options.packageRoot,
    sourceRoot,
    outputDir: options.normalizedConfig.output,
    outputFormats: options.outputFormats,
    patterns: options.normalizedConfig.styles.shared.output,
  });
}

export function checkSharedOutputExports(options: {
  packageRoot: string;
  entries: Array<SharedOutputEntry>;
}) {
  if (!options.entries.length) return [] as Array<SharedOutputExportCheck>;

  const packageJsonFile = path.join(options.packageRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')) as {
    exports?: Exports;
  };
  if (!packageJson.exports) {
    return options.entries.map((entry) => ({
      exportSubpath: entry.exportSubpath,
      exportTarget: null,
      expectedTargetRelative: expectedExportRelative(entry),
      ok: false,
      reason: 'package.json#exports is missing',
    }));
  }

  return options.entries.map((entry) => {
    const expectedTargetRelative = expectedExportRelative(entry);
    const target = (() => {
      try {
        return findPathInExports(
          entry.exportSubpath,
          packageJson.exports!,
          STYLE_PACKAGE_EXPORT_CONDITIONS,
        );
      } catch {
        return null;
      }
    })();
    if (!target) {
      return {
        exportSubpath: entry.exportSubpath,
        exportTarget: null,
        expectedTargetRelative,
        ok: false,
        reason: 'subpath is not exported',
      };
    }
    const normalizedTarget = toPosixPath(target.replace(/^\.\//, ''));
    const accepted = new Set(
      entry.kind === 'module' ? entry.jsFiles : entry.assetFiles,
    );
    if (!accepted.has(normalizedTarget)) {
      return {
        exportSubpath: entry.exportSubpath,
        exportTarget: target,
        expectedTargetRelative,
        ok: false,
        reason: `export target should be ./${expectedTargetRelative}`,
      };
    }
    return {
      exportSubpath: entry.exportSubpath,
      exportTarget: target,
      expectedTargetRelative,
      ok: true,
    };
  });
}

const expectedExportRelative = (entry: SharedOutputEntry) => {
  if (entry.kind === 'module') {
    return entry.jsFiles[0] ?? entry.jsRelative ?? entry.assetRelative;
  }
  return entry.assetFiles[0] ?? entry.assetRelative;
};

export function checkSharedOutputDistFiles(options: {
  packageRoot: string;
  entries: Array<SharedOutputEntry>;
}) {
  return options.entries.flatMap((entry) => {
    const files =
      entry.kind === 'module'
        ? [...entry.assetFiles, ...entry.jsFiles]
        : [...entry.assetFiles];
    return files.map((relative) => {
      const absolute = path.join(options.packageRoot, relative);
      return {
        entry: entry.exportSubpath,
        file: relative,
        exists: fs.existsSync(absolute),
      };
    });
  });
}

// Strip `{outputDir}/{format}/` from a package-relative published asset path.
export function stripSharedOutputPublishedAssetRelative(options: {
  relativeFromPackageRoot: string;
  outputDir: string;
  outputFormats: Array<string>;
}) {
  const relative = toPosixPath(options.relativeFromPackageRoot).replace(
    /^\.\//,
    '',
  );
  const outputDir = toPosixPath(options.outputDir).replace(/\/+$/, '');
  if (!outputDir || !options.outputFormats.length) return null;

  for (const format of options.outputFormats) {
    const prefix = `${outputDir}/${format}/`;
    if (relative.startsWith(prefix)) {
      return relative.slice(prefix.length) || null;
    }
  }
  return null;
}

export function isPublishedPlainSharedOutputAssetTarget(
  target: string,
  options: { outputDir: string; outputFormats: Array<string> },
) {
  const normalized = toPosixPath(target.replace(/^\.\//, ''));
  if (
    !PLAIN_STYLE_EXTENSIONS.has(path.extname(normalized).toLowerCase()) ||
    isCssModuleFile(normalized)
  ) {
    return false;
  }
  return (
    stripSharedOutputPublishedAssetRelative({
      relativeFromPackageRoot: normalized,
      outputDir: options.outputDir,
      outputFormats: options.outputFormats,
    }) != null
  );
}

export type SharedOutputResolveCacheEntry = {
  sourceRoot: string;
  outputDir: string;
  outputFormats: Array<string>;
  moduleFileKeys: Set<string>;
  plainFileKeys: Set<string>;
};

// Single process-local cache for workspace Modules/plain resolve + Less remap.
// Stores a shared.output glob snapshot; refreshed on auklet.config.* (not on
// every file add/remove). See docs/css.md.
const sharedOutputResolveCache = new Map<
  string,
  SharedOutputResolveCacheEntry
>();

export function getSharedOutputResolveCache(packageRoot: string) {
  return sharedOutputResolveCache.get(normalizeFileKey(packageRoot)) ?? null;
}

export function setSharedOutputResolveCache(
  packageRoot: string,
  entry: SharedOutputResolveCacheEntry,
) {
  sharedOutputResolveCache.set(normalizeFileKey(packageRoot), entry);
}

export function clearSharedOutputResolveCache(packageRoot?: string) {
  if (packageRoot == null) {
    sharedOutputResolveCache.clear();
    return;
  }
  sharedOutputResolveCache.delete(normalizeFileKey(packageRoot));
}

// Map `{output}/{format}/<rel>` → source file when it is a shared.output plain asset.
export function remapSharedOutputDistAssetToSource(options: {
  packageRoot: string;
  sourceRoot: string;
  outputDir: string;
  outputFormats: Array<string>;
  resolvedFile: string;
  plainFileKeys: Iterable<string>;
}) {
  const packageRoot = path.resolve(options.packageRoot);
  const resolved = path.resolve(options.resolvedFile);
  const relative = toPosixPath(path.relative(packageRoot, resolved));
  const assetRelative = stripSharedOutputPublishedAssetRelative({
    relativeFromPackageRoot: relative,
    outputDir: options.outputDir,
    outputFormats: options.outputFormats,
  });
  if (!assetRelative) return null;

  const sourceCandidate = path.resolve(options.sourceRoot, assetRelative);
  const sourceKeys =
    options.plainFileKeys instanceof Set
      ? options.plainFileKeys
      : new Set(options.plainFileKeys);
  if (
    !sourceKeys.has(normalizeFileKey(sourceCandidate)) ||
    !fs.existsSync(sourceCandidate)
  ) {
    return null;
  }
  return fs.realpathSync.native(sourceCandidate);
}

// Sync remap for external Less after exports resolve to published *.less.
// Prefers export-subpath mirror under sourceRoot; else strips configured
// `{output}/{format}/`. Requires warm sharedOutputResolveCache.
export function remapWorkspaceSharedOutputLessFile(options: {
  packageRoot: string;
  resolvedFile: string;
  sourceRelative?: string | null;
}) {
  if (isInstalledNodeModulesPath(options.packageRoot)) return null;
  const cache = getSharedOutputResolveCache(options.packageRoot);
  if (!cache) return null;

  if (options.sourceRelative) {
    const mirrored = path.resolve(
      cache.sourceRoot,
      toPosixPath(options.sourceRelative).replace(/^\.\//, ''),
    );
    if (
      cache.plainFileKeys.has(normalizeFileKey(mirrored)) &&
      fs.existsSync(mirrored)
    ) {
      return fs.realpathSync.native(mirrored);
    }
  }

  return remapSharedOutputDistAssetToSource({
    packageRoot: options.packageRoot,
    sourceRoot: cache.sourceRoot,
    outputDir: cache.outputDir,
    outputFormats: cache.outputFormats,
    resolvedFile: options.resolvedFile,
    plainFileKeys: cache.plainFileKeys,
  });
}
