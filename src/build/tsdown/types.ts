import type { UserConfig } from 'tsdown/config';
import type {
  ConfigureTsdownContext,
  PackageBuildFormat,
  PackageBuildOptions,
} from '#auklet/types';

export type TsdownFormat = PackageBuildFormat;

export type PackageJsonLike = {
  name?: string;
  version?: string;
  author?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type BuildContext = {
  packageRoot: string;
  tsconfig: string;
  output: string;
  pkg: PackageJsonLike;
  runtimeDependencyNames: Array<string>;
  packageExternal: Array<string>;
  peerExternal: Array<string>;
  alias: Record<string, string>;
  mainFields?: Array<string>;
  globals: Record<string, string>;
  banner: string;
  globalName: string;
  target: NonNullable<PackageBuildOptions['target']>;
  platform: NonNullable<PackageBuildOptions['platform']>;
  configureTsdown?: PackageBuildOptions['configureTsdown'];
};

export type TsdownDeps = NonNullable<UserConfig['deps']>;

export type ConfigureTsdownOptions = Pick<
  ConfigureTsdownContext,
  'kind' | 'format'
>;
