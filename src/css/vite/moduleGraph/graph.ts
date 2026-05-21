import path from 'node:path';
import { aukletConfigFile } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { ModuleStyleGraphRequestCache } from '#auklet/css/vite/moduleGraph/requestCache';
import { StyleCodeFactory } from '#auklet/css/vite/moduleGraph/styleCodeFactory';
import { parsePackageStyleId } from '#auklet/css/vite/moduleGraph/styleId';
import type {
  ModuleStyleGraphOptions,
  PackageStyleId,
} from '#auklet/css/vite/moduleGraph/types';
import { SOURCE_COMPONENT_MODULE_RE } from '#auklet/css/constants';
import { normalizeFileKey, toWatchPath } from '#auklet/utils';

// package style graph 的对外门面，负责 workspace 发现、watch 边界和请求分发。
export class ModuleStyleGraph {
  private readonly config: NonNullable<ModuleStyleGraphOptions['config']>;
  private readonly workspaceRoot: string;
  private readonly packagesDir: string;
  private readonly styleCodeFactory: StyleCodeFactory;
  private readonly loadAukletConfig: NonNullable<
    ModuleStyleGraphOptions['loadAukletConfig']
  >;

  constructor(options: ModuleStyleGraphOptions) {
    this.config = options.config ?? moduleStyleBuildConfig;
    this.workspaceRoot = normalizeFileKey(options.workspaceRoot);
    this.packagesDir = options.packagesDir ?? 'packages';
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
    this.styleCodeFactory = new StyleCodeFactory(this.config);
  }

  parsePackageStyleId(id: string) {
    return parsePackageStyleId(id, this.getWorkspacePackageNames());
  }

  isWorkspaceSourceGraphFile(file: string) {
    const normalizedFile = normalizeFileKey(file);
    const packagesRoot = normalizeFileKey(
      path.join(this.workspaceRoot, this.packagesDir),
    );
    if (!normalizedFile.startsWith(`${packagesRoot}/`)) {
      return false;
    }
    if (normalizedFile.endsWith(aukletConfigFile)) return true;
    if (SOURCE_COMPONENT_MODULE_RE.test(normalizedFile)) {
      return true;
    }

    return this.config.styleExtensions.some((extension) =>
      normalizedFile.endsWith(extension),
    );
  }

  isStyleConfigFile(file: string) {
    return normalizeFileKey(file).endsWith(aukletConfigFile);
  }

  isStyleFile(file: string) {
    return this.config.styleExtensions.includes(path.extname(file));
  }

  getWorkspacePackageNames() {
    return this.createRequestCache().getWorkspacePackageNames();
  }

  getWatchRoots() {
    const packagesRoot = path.join(this.workspaceRoot, this.packagesDir);
    return [
      toWatchPath(packagesRoot, '*', 'src'),
      toWatchPath(packagesRoot, '*', aukletConfigFile),
    ];
  }

  createPackageStyleCode(parsed: PackageStyleId) {
    return this.styleCodeFactory.createPackageStyleCode(
      parsed,
      this.createRequestCache(),
    );
  }

  private createRequestCache() {
    return new ModuleStyleGraphRequestCache({
      workspaceRoot: this.workspaceRoot,
      packagesDir: this.packagesDir,
      config: this.config,
      loadAukletConfig: this.loadAukletConfig,
    });
  }
}
