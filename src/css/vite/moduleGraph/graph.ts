import path from 'node:path';
import { aukletConfigFile } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { parsePackageStyleId } from '#auklet/css/vite/moduleGraph/styleId';
import { StyleCodeFactory } from '#auklet/css/vite/moduleGraph/styleCodeFactory';
import { ModuleStyleGraphRequestCache } from '#auklet/css/vite/moduleGraph/requestCache';
import { createMonorepoPackageSource } from '#auklet/css/vite/moduleGraph/packageSource/monorepo';
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
  private readonly loadAukletConfig: NonNullable<
    ModuleStyleGraphOptions['loadAukletConfig']
  >;

  constructor(options: ModuleStyleGraphOptions) {
    this.config = options.config ?? moduleStyleBuildConfig;
    const mode = options.mode ?? 'monorepo';
    if (mode === 'package') {
      throw new Error('[auklet:css] package mode is not supported yet.');
    }
    this.packageSource = createMonorepoPackageSource({
      workspaceRoot: normalizeFileKey(options.workspaceRoot),
      packagesDir: options.packagesDir ?? 'packages',
      styleExtensions: this.config.styleExtensions,
    });
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
    this.styleCodeFactory = new StyleCodeFactory(this.config);
  }

  parsePackageStyleId(id: string) {
    return parsePackageStyleId(id, this.getPackageNames());
  }

  isSourceGraphFile(file: string) {
    return this.packageSource.isSourceGraphFile(file);
  }

  isStyleConfigFile(file: string) {
    return normalizeFileKey(file).endsWith(aukletConfigFile);
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
      this.createRequestCache(),
    );
  }

  private createRequestCache() {
    return new ModuleStyleGraphRequestCache({
      packageSource: this.packageSource,
      config: this.config,
      loadAukletConfig: this.loadAukletConfig,
    });
  }
}
