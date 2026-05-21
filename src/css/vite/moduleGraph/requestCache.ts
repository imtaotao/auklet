import fs from 'node:fs';
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

type WorkspacePackage = {
  packageName: string;
  packageRoot: string;
};

// 单次虚拟 CSS 请求内的上下文缓存；每次请求新建，确保跨请求能看到配置和源码变化。
export type ModuleStyleGraphRequestCacheOptions = {
  workspaceRoot: string;
  packagesDir: string;
  config: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
};

export class ModuleStyleGraphRequestCache {
  private workspacePackages?: Array<WorkspacePackage>;
  private workspacePackageNames?: Array<string>;
  private readonly contexts = new Map<
    string,
    Promise<PackageStyleContext | null>
  >();
  private readonly loadAukletConfig: LoadAukletConfig;

  constructor(private readonly options: ModuleStyleGraphRequestCacheOptions) {
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
  }

  getWorkspacePackageNames() {
    this.workspacePackageNames ??= this.getWorkspacePackages().map(
      (item) => item.packageName,
    );
    return this.workspacePackageNames;
  }

  isWorkspacePackageName(packageName: string) {
    return this.getWorkspacePackageNames().includes(packageName);
  }

  async getContext(parsed: PackageStyleId) {
    const cachedContext = this.contexts.get(parsed.packageName);
    if (cachedContext) return cachedContext;

    const context = this.createContext(parsed);
    this.contexts.set(parsed.packageName, context);
    return context;
  }

  private async createContext(parsed: PackageStyleId) {
    const workspacePackage = this.getWorkspacePackages().find(
      (item) => item.packageName === parsed.packageName,
    );
    if (!workspacePackage) return null;

    const packageRoot = workspacePackage.packageRoot;
    if (!fs.existsSync(packageRoot)) return null;

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

  private getWorkspacePackages() {
    if (this.workspacePackages) return this.workspacePackages;

    const packagesRoot = path.join(
      this.options.workspaceRoot,
      this.options.packagesDir,
    );
    if (!fs.existsSync(packagesRoot)) {
      this.workspacePackages = [];
      return this.workspacePackages;
    }

    this.workspacePackages = fs
      .readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const packageRoot = path.join(packagesRoot, entry.name);
        const packageJsonPath = path.join(packageRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) return [];

        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
          name?: string;
        };
        if (!pkg.name) return [];

        return [
          {
            packageName: pkg.name,
            packageRoot,
          },
        ];
      });

    return this.workspacePackages;
  }
}
