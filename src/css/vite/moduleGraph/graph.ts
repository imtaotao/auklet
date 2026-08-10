import path from 'node:path';
import { isAukletConfigFile } from '#auklet/config';
import { normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import {
  findPackageRootForFile,
  readPackageName,
} from '#auklet/css/core/resolvers/externalLess';
import { parsePackageStyleId } from '#auklet/css/vite/moduleGraph/styleId';
import { StyleCodeFactory } from '#auklet/css/vite/moduleGraph/styleCodeFactory';
import { ModuleStyleGraphRequestCache } from '#auklet/css/vite/moduleGraph/requestCache';
import { MonorepoPackageSource } from '#auklet/css/vite/moduleGraph/packageSource/monorepo';
import { SinglePackageSource } from '#auklet/css/vite/moduleGraph/packageSource/singlePackage';
import type { StylePackageSource } from '#auklet/css/vite/moduleGraph/packageSource/types';
import type {
  ModuleStyleGraphOptions,
  PackageStyleId,
} from '#auklet/css/vite/moduleGraph/types';
import { isPackageJsonFile, normalizeFileKey } from '#auklet/utils';

// package style graph 的对外门面，负责 package source、watch 边界和请求分发。
export class ModuleStyleGraph {
  private readonly config: NonNullable<ModuleStyleGraphOptions['config']>;
  private readonly packageSource: StylePackageSource;
  private readonly styleCodeFactory: StyleCodeFactory;
  private readonly requestCache: ModuleStyleGraphRequestCache;
  private readonly loadAukletConfig: NonNullable<
    ModuleStyleGraphOptions['loadAukletConfig']
  >;

  constructor(options: ModuleStyleGraphOptions) {
    this.config = options.config ?? moduleStyleBuildConfig;
    this.styleCodeFactory = new StyleCodeFactory(this.config);
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
    this.packageSource =
      (options.mode ?? 'package') === 'monorepo'
        ? new MonorepoPackageSource({
            root: normalizeFileKey(options.root),
            styleExtensions: this.config.styleExtensions,
          })
        : new SinglePackageSource({
            root: normalizeFileKey(options.root),
            styleExtensions: this.config.styleExtensions,
            loadAukletConfig: this.loadAukletConfig,
          });
    this.requestCache = new ModuleStyleGraphRequestCache({
      root: normalizeFileKey(options.root),
      mode: options.mode ?? 'package',
      packageSource: this.packageSource,
      config: this.config,
      loadAukletConfig: this.loadAukletConfig,
    });
  }

  parsePackageStyleId(id: string) {
    return parsePackageStyleId(id, this.getPackageNames());
  }

  isSourceGraphFile(file: string) {
    return this.packageSource.isSourceGraphFile(file);
  }

  isStyleConfigFile(file: string) {
    return isAukletConfigFile(path.basename(normalizeFileKey(file)));
  }

  isStyleFile(file: string) {
    return this.config.styleExtensions.includes(path.extname(file));
  }

  isPackageManifestFile(file: string) {
    if (!isPackageJsonFile(file)) return false;
    const normalizedFile = normalizeFileKey(file);
    return this.packageSource
      .getPackages()
      .some(
        (item) =>
          normalizeFileKey(path.join(item.packageRoot, 'package.json')) ===
          normalizedFile,
      );
  }

  getPackageNames() {
    return this.packageSource.getPackageNames();
  }

  getWatchRoots() {
    return this.packageSource.getWatchRoots();
  }

  createPackageStyleCode(parsed: PackageStyleId) {
    return this.styleCodeFactory.createPackageStyleCode(
      parsed,
      this.requestCache,
    );
  }

  peekPackageStyleCode(parsed: PackageStyleId) {
    return this.requestCache.peekLoadResult(parsed);
  }

  invalidatePackage(packageName: string) {
    this.requestCache.invalidatePackage(packageName);
  }

  invalidateFileLoadResults(file: string) {
    const packageName = this.getFilePackageName(file);
    if (!packageName) return null;

    this.requestCache.invalidatePackageLoadResults(packageName);
    return packageName;
  }

  invalidateDependencyFile(file: string) {
    const workspacePackage = this.getFilePackageName(file);
    if (workspacePackage) {
      this.requestCache.invalidatePackageLoadResults(workspacePackage);
      return workspacePackage;
    }

    const dependencyPackage = this.resolveExternalDependencyPackageName(file);
    if (
      !dependencyPackage ||
      !this.requestCache.hasTrackedPackageLoadResults(dependencyPackage)
    ) {
      return null;
    }

    this.requestCache.invalidatePackageLoadResults(dependencyPackage);
    return dependencyPackage;
  }

  invalidateFile(file: string) {
    const packageName = this.getFilePackageName(file);
    if (!packageName) return null;

    this.invalidatePackage(packageName);
    return packageName;
  }

  isSourceModuleFile(file: string) {
    return SOURCE_MODULE_RE.test(normalizeFileKey(file));
  }

  async resolveSourceRootForFile(file: string) {
    const packageRoot = this.getFilePackageRoot(file);
    if (!packageRoot) return null;

    const rawConfig = await this.loadAukletConfig(packageRoot, {
      cacheBust: true,
    });
    const normalizedConfig = normalizeAukletConfig(rawConfig);
    return path.join(packageRoot, normalizedConfig.source);
  }

  resolvePackageRootForFile(file: string) {
    return this.getFilePackageRoot(file);
  }

  private getFilePackageRoot(file: string) {
    return this.getFileStylePackage(file)?.packageRoot ?? null;
  }

  private getFilePackageName(file: string) {
    return this.getFileStylePackage(file)?.packageName ?? null;
  }

  private getFileStylePackage(file: string) {
    if (!this.isSourceGraphFile(file) && !this.isPackageManifestFile(file)) {
      return null;
    }

    const normalizedFile = normalizeFileKey(file);
    return (
      this.packageSource
        .getPackages()
        .find((item) => this.isPackageFile(item.packageRoot, normalizedFile)) ??
      null
    );
  }

  private resolveExternalDependencyPackageName(file: string) {
    const packageRoot = findPackageRootForFile(file);
    if (!packageRoot) return null;

    const normalizedPackageRoot = normalizeFileKey(packageRoot);
    if (
      this.packageSource
        .getPackages()
        .some(
          (item) =>
            normalizeFileKey(item.packageRoot) === normalizedPackageRoot,
        )
    ) {
      return null;
    }

    return readPackageName(packageRoot);
  }

  private isPackageFile(packageRoot: string, file: string) {
    const normalizedPackageRoot = normalizeFileKey(packageRoot);
    return (
      file === normalizedPackageRoot ||
      file.startsWith(`${normalizedPackageRoot}/`)
    );
  }
}
