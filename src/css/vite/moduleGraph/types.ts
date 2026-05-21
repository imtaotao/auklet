import type { AukletConfig, ModuleStyleBuildConfig } from '#auklet/types';

// Vite/dev module style graph 的共享类型。
export interface ModuleStyleGraphOptions {
  workspaceRoot: string;
  packagesDir?: string;
  config?: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
}

export type PackageStyleId = {
  packageName: string;
  stylePath: string;
};

export type PackageStyleLoadResult = {
  code: string;
  watchFiles: Array<string>;
};

export type LoadAukletConfig = (
  packageRoot: string,
  options?: { cacheBust?: boolean },
) => Promise<AukletConfig>;
