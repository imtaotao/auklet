import path from 'node:path';
import { aukletConfigFile, normalizeAukletConfig } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
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
} from '#auklet/css/vite/moduleGraph/types';

export type PackageStyleContext = {
  normalizedConfig: NormalizedAukletConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
  packageName: string;
  configPath: string;
  resolver: WorkspaceStyleResolver;
  sourceRoot: string;
  styleProcessor: StyleProcessor;
};

// 单次虚拟 CSS 请求内的上下文缓存；每次请求新建，确保跨请求能看到配置和源码变化。
export type ModuleStyleGraphRequestCacheOptions = {
  packageSource: StylePackageSource;
  config: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
};

export class ModuleStyleGraphRequestCache {
  private readonly contexts = new Map<
    string,
    Promise<PackageStyleContext | null>
  >();
  private readonly loadAukletConfig: LoadAukletConfig;

  constructor(private readonly options: ModuleStyleGraphRequestCacheOptions) {
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
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

  private async createContext(parsed: PackageStyleId) {
    const stylePackage = this.options.packageSource
      .getPackages()
      .find((item) => item.packageName === parsed.packageName);
    if (!stylePackage) return null;

    const packageRoot = stylePackage.packageRoot;

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
      normalizedConfig,
      context,
      packageContext,
      packageName: parsed.packageName,
      configPath: path.join(packageRoot, aukletConfigFile),
      resolver: packageContext.resolver,
      sourceRoot: packageContext.sourceRoot,
      styleProcessor: packageContext.styleProcessor,
    };
  }
}
