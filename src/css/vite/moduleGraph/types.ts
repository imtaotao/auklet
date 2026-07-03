import type { AukletConfig, ModuleStyleBuildConfig } from '#auklet/types';

// Vite/dev module style graph 的共享类型。
export interface ModuleStyleGraphOptions {
  root: string;
  mode?: 'monorepo' | 'package';
  config?: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
}

export type PackageStyleId = {
  packageName: string;
  stylePath: string;
};

export type PackageStyleWatchFileKind = 'entry' | 'dependency';

export type PackageStyleWatchFile = {
  file: string;
  kind: PackageStyleWatchFileKind;
};

export type PackageStyleLoadResult = {
  code: string;
  cacheInputFiles?: Array<string>;
  watchFiles: Array<string>;
  watchFileKinds?: Array<PackageStyleWatchFile>;
  dependencyPackages?: Array<string>;
};

export type LoadAukletConfig = (
  packageRoot: string,
  options?: { cacheBust?: boolean },
) => Promise<AukletConfig>;
