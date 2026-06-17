import path from 'node:path';
import {
  loadAukletConfig,
  resolveAukletConfigPath,
} from '#auklet/configLoader';
import { aukletConfigFiles, normalizeAukletConfig } from '#auklet/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { PersistentStyleGraphCache } from '#auklet/css/vite/moduleGraph/persistentCache';
import type {
  ModuleStyleBuildConfig,
  NormalizedAukletConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';
import type { StyleProcessor } from '#auklet/css/core/styleProcessor';
import type { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import type { StylePackageSource } from '#auklet/css/vite/moduleGraph/packageSource/types';
import type {
  LoadAukletConfig,
  PackageStyleId,
  PackageStyleLoadResult,
} from '#auklet/css/vite/moduleGraph/types';
import { normalizeFileKey, toPosixPath } from '#auklet/utils';

export type PackageStyleContext = {
  normalizedConfig: NormalizedAukletConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
  packageName: string;
  configPaths: Array<string>;
  resolver: WorkspaceStyleResolver;
  sourceRoot: string;
  styleProcessor: StyleProcessor;
};

// Vite dev graph 生命周期内的上下文缓存；文件变化时由 graph/watcher 按包失效。
export type ModuleStyleGraphRequestCacheOptions = {
  root: string;
  mode: 'monorepo' | 'package';
  packageSource: StylePackageSource;
  config: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
};

export class ModuleStyleGraphRequestCache {
  private readonly contexts = new Map<
    string,
    Promise<PackageStyleContext | null>
  >();
  private readonly loadResults = new Map<
    string,
    Promise<PackageStyleLoadResult>
  >();
  private readonly loadResultDependencies = new Map<string, Set<string>>();
  private readonly loadAukletConfig: LoadAukletConfig;
  private readonly persistentCache: PersistentStyleGraphCache;

  constructor(private readonly options: ModuleStyleGraphRequestCacheOptions) {
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
    this.persistentCache = new PersistentStyleGraphCache({
      root: options.root,
    });
  }

  getPackageNames() {
    return this.options.packageSource.getPackageNames();
  }

  isKnownPackageName(packageName: string) {
    return this.options.packageSource.isKnownPackageName(packageName);
  }

  async getContext(parsed: PackageStyleId) {
    const cachedContext = this.contexts.get(parsed.packageName);
    if (cachedContext) return cachedContext;

    const context = this.createContext(parsed);
    this.contexts.set(parsed.packageName, context);
    return context;
  }

  getLoadResult(
    parsed: PackageStyleId,
    create: () => Promise<PackageStyleLoadResult>,
  ) {
    const key = this.getLoadResultKey(parsed);
    const cachedResult = this.loadResults.get(key);
    if (cachedResult) return cachedResult;

    const result = create().then((value) => {
      this.loadResultDependencies.set(
        key,
        new Set(value.dependencyPackages ?? []),
      );
      return value;
    });
    this.loadResults.set(key, result);
    return result;
  }

  invalidatePackage(packageName: string) {
    this.contexts.delete(packageName);
    this.invalidateLoadResults(packageName);
  }

  readPersistentLoadResult(
    parsed: PackageStyleId,
    context: PackageStyleContext,
  ) {
    return this.persistentCache.read(this.createPersistentKey(parsed, context));
  }

  writePersistentLoadResult(
    parsed: PackageStyleId,
    context: PackageStyleContext,
    result: PackageStyleLoadResult,
  ) {
    const cacheInputFiles = this.getPersistentInputFiles(context, result);
    const cacheResult = {
      ...result,
      cacheInputFiles,
    };
    this.persistentCache.write(
      this.createPersistentKey(parsed, context),
      cacheResult,
      cacheInputFiles,
    );
    return cacheResult;
  }

  private async createContext(parsed: PackageStyleId) {
    const stylePackage = this.options.packageSource
      .getPackages()
      .find((item) => item.packageName === parsed.packageName);
    if (!stylePackage) return null;

    const packageRoot = stylePackage.packageRoot;
    const configPath = resolveAukletConfigPath(packageRoot);
    const configPaths = configPath
      ? [configPath]
      : aukletConfigFiles.map((file) => path.join(packageRoot, file));

    const rawConfig = await this.loadAukletConfig(packageRoot, {
      cacheBust: true,
    });
    const normalizedConfig = normalizeAukletConfig(rawConfig);
    const context: ResolvedModuleStyleBuildContext = {
      packageRoot,
      sourceDir: normalizedConfig.source,
      outputDir: normalizedConfig.output,
    };
    const packageContext = new StylePackageContext({
      config: this.options.config,
      context,
      normalizedConfig,
    });

    return {
      context,
      configPaths,
      packageContext,
      normalizedConfig,
      packageName: parsed.packageName,
      resolver: packageContext.resolver,
      sourceRoot: packageContext.sourceRoot,
      styleProcessor: packageContext.styleProcessor,
    };
  }

  private createPersistentKey(
    parsed: PackageStyleId,
    context: PackageStyleContext,
  ) {
    return this.persistentCache.createKey({
      config: this.options.config,
      mode: this.options.mode,
      normalizedConfig: context.normalizedConfig,
      packageName: context.packageName,
      packageNames: this.getPackageNames(),
      packages: this.getPackageKeyEntries(),
      packageRoot: normalizeFileKey(context.context.packageRoot),
      parsed,
      root: normalizeFileKey(this.options.root),
      sourceFiles: context.packageContext.sourceFiles.map((file) =>
        toPosixPath(path.relative(context.sourceRoot, file)),
      ),
      sourceRoot: normalizeFileKey(context.sourceRoot),
    });
  }

  private getPersistentInputFiles(
    context: PackageStyleContext,
    result: PackageStyleLoadResult,
  ) {
    return [
      ...result.watchFiles,
      ...(result.cacheInputFiles ?? []),
      ...this.getSourceInputFiles(
        context.sourceRoot,
        context.packageContext.sourceFiles,
      ),
      ...this.getResolutionInputFiles(context.context.packageRoot),
      ...this.getWorkspaceInputFiles(),
    ];
  }

  private getPackageKeyEntries() {
    return this.options.packageSource
      .getPackages()
      .map((item) => ({
        packageName: item.packageName,
        packageRoot: normalizeFileKey(item.packageRoot),
      }))
      .sort((left, right) => {
        const nameOrder = left.packageName.localeCompare(right.packageName);
        if (nameOrder !== 0) return nameOrder;
        return left.packageRoot.localeCompare(right.packageRoot);
      });
  }

  private getWorkspaceInputFiles() {
    if (this.options.mode !== 'monorepo') return [];
    return [path.join(this.options.root, 'pnpm-workspace.yaml')];
  }

  private getSourceInputFiles(sourceRoot: string, sourceFiles: Array<string>) {
    const sourceInputFiles = new Set([sourceRoot, ...sourceFiles]);
    const normalizedSourceRoot = normalizeFileKey(sourceRoot);

    for (const file of sourceFiles) {
      let current = path.dirname(file);
      let currentKey = normalizeFileKey(current);

      while (
        currentKey === normalizedSourceRoot ||
        currentKey.startsWith(`${normalizedSourceRoot}/`)
      ) {
        sourceInputFiles.add(current);
        if (currentKey === normalizedSourceRoot) break;
        const parent = path.dirname(current);
        current = parent;
        currentKey = normalizeFileKey(current);
      }
    }
    return Array.from(sourceInputFiles);
  }

  private getResolutionInputFiles(packageRoot: string) {
    const files = [path.join(packageRoot, 'package.json')];
    let current = packageRoot;
    const graphRoot = normalizeFileKey(this.options.root);
    let reachedGraphRoot = false;

    while (!reachedGraphRoot) {
      const tsconfig = path.join(current, 'tsconfig.json');
      files.push(tsconfig);
      reachedGraphRoot = normalizeFileKey(current) === graphRoot;
      if (reachedGraphRoot) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return Array.from(new Set(files));
  }

  private getLoadResultKey(parsed: PackageStyleId) {
    return `${parsed.packageName}\0${parsed.stylePath}`;
  }

  private getLoadResultPackageName(key: string) {
    return key.split('\0')[0];
  }

  private invalidateLoadResults(packageName: string) {
    const invalidPackageNames = new Set([packageName]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const [key, dependencyPackages] of this.loadResultDependencies) {
        const resultPackageName = this.getLoadResultPackageName(key);
        const shouldInvalidate =
          invalidPackageNames.has(resultPackageName) ||
          Array.from(dependencyPackages).some((dependencyPackage) =>
            invalidPackageNames.has(dependencyPackage),
          );

        if (!shouldInvalidate) continue;
        if (!invalidPackageNames.has(resultPackageName)) {
          invalidPackageNames.add(resultPackageName);
          changed = true;
        }
      }
    }

    for (const key of this.loadResults.keys()) {
      if (!invalidPackageNames.has(this.getLoadResultPackageName(key))) {
        const dependencyPackages = this.loadResultDependencies.get(key);
        if (
          !dependencyPackages ||
          !Array.from(dependencyPackages).some((dependencyPackage) =>
            invalidPackageNames.has(dependencyPackage),
          )
        ) {
          continue;
        }
      }
      this.loadResults.delete(key);
      this.loadResultDependencies.delete(key);
    }
  }
}
