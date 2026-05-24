export type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  files?: Array<string>;
  publishConfig?: {
    access?: string;
    [key: string]: unknown;
  };
  auklet?: {
    publish?: PublishPackageConfig;
    [key: string]: unknown;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export type PublishPackageConfig = {
  format?: boolean;
  before?: PublishHookConfig;
  afterSuccess?: PublishHookConfig;
  afterFailure?: PublishHookConfig;
};

export type PublishHookConfig = string | Array<string>;

export type PublishTarget = {
  packageRoot: string;
  packageName: string;
  version: string;
  publishVersion: string;
  private: boolean;
  kind: 'package' | 'lib';
  workspaceMode: 'single' | 'monorepo';
  packageJson: PackageJson;
};

export type WorkspacePackage = {
  name: string;
  path: string;
  version: string;
  private?: boolean;
};

export type PublishOptions = {
  cwd: string;
  filters: Array<string>;
  version?: string;
  dryRun: boolean;
  otp?: string;
  ignoreScripts: boolean;
};

export type OwnerOptions = {
  cwd: string;
  users: Array<string>;
  filters: Array<string>;
  packages: Array<string>;
  otp?: string;
};

export type PublishPlan = {
  root: string;
  version: string;
  dryRun: boolean;
  targets: Array<PublishTarget>;
  config: PublishPackageConfig;
  workspaceMode: 'single' | 'monorepo';
};

export type HookStatus = 'before' | 'success' | 'failure';
