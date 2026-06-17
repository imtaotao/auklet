import path from 'node:path';
import { isAukletConfigFile } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { moduleStyleBuildConfig } from '#auklet/css/config';
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
import { normalizeFileKey } from '#auklet/utils';

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

  invalidatePackage(packageName: string) {
    this.requestCache.invalidatePackage(packageName);
  }

  invalidateFile(file: string) {
    if (!this.isSourceGraphFile(file)) return null;

    const normalizedFile = normalizeFileKey(file);
    const stylePackage = this.packageSource
      .getPackages()
      .find((item) => this.isPackageFile(item.packageRoot, normalizedFile));

    if (!stylePackage) return null;

    this.invalidatePackage(stylePackage.packageName);
    return stylePackage.packageName;
  }

  isSourceModuleFile(file: string) {
    return SOURCE_MODULE_RE.test(normalizeFileKey(file));
  }

  private isPackageFile(packageRoot: string, file: string) {
    const normalizedPackageRoot = normalizeFileKey(packageRoot);
    return (
      file === normalizedPackageRoot ||
      file.startsWith(`${normalizedPackageRoot}/`)
    );
  }
}
