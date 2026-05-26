import fs from 'node:fs';
import path from 'node:path';
import { aukletConfigFiles, isAukletConfigFile } from '#auklet/config';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { normalizeFileKey, toPosixPath, toWatchPath } from '#auklet/utils';
import { readPnpmWorkspacePackageInfoSync } from '#auklet/workspace/packages';
import type { WorkspacePackageInfo } from '#auklet/workspace/packages';
import type {
  StylePackageInfo,
  StylePackageSource,
} from '#auklet/css/vite/moduleGraph/packageSource/types';

export type MonorepoPackageSourceOptions = {
  root: string;
  styleExtensions: Array<string>;
  readWorkspacePackages?: (root: string) => Array<WorkspacePackageInfo>;
};

export class MonorepoPackageSource implements StylePackageSource {
  private packages?: Array<StylePackageInfo>;
  private packageNames?: Array<string>;
  private readonly root: string;
  private readonly rawRoot: string;

  constructor(private readonly options: MonorepoPackageSourceOptions) {
    this.root = normalizeFileKey(options.root);
    this.rawRoot = toPosixPath(path.resolve(options.root));
  }

  getPackages() {
    if (this.packages) return this.packages;
    this.packages = this.getWorkspacePackages() ?? [];

    return this.packages;
  }

  getPackageNames() {
    this.packageNames ??= this.getPackages().map((item) => item.packageName);
    return this.packageNames;
  }

  isKnownPackageName(packageName: string) {
    return this.getPackageNames().includes(packageName);
  }

  isSourceGraphFile(file: string) {
    const normalizedFile = normalizeFileKey(file);
    const packages = this.getPackages();
    if (!packages.some((item) => isPackageFile(item, normalizedFile))) {
      return false;
    }
    if (isAukletConfigFile(path.basename(normalizedFile))) return true;
    if (SOURCE_MODULE_RE.test(normalizedFile)) return true;

    return this.options.styleExtensions.some((extension) =>
      normalizedFile.endsWith(extension),
    );
  }

  async getWatchRoots() {
    return this.getPackages().flatMap((item) => [
      toWatchPath(item.packageRoot, 'src'),
      ...aukletConfigFiles.map((file) => toWatchPath(item.packageRoot, file)),
    ]);
  }

  private getWorkspacePackages() {
    const readWorkspacePackages = this.options.readWorkspacePackages;
    if (
      !readWorkspacePackages &&
      !fs.existsSync(path.join(this.options.root, 'pnpm-workspace.yaml'))
    ) {
      return null;
    }

    try {
      const readPackages =
        readWorkspacePackages ?? readPnpmWorkspacePackageInfoSync;
      return readPackages(this.options.root)
        .filter((item) => !this.isWorkspaceRootPackage(item))
        .map((item) => ({
          packageName: item.name,
          packageRoot: normalizeFileKey(item.path),
        }));
    } catch (error) {
      throw new Error(
        '[auklet:css] failed to read pnpm workspace packages for Vite monorepo mode.',
        { cause: error },
      );
    }
  }

  private isWorkspaceRootPackage(item: WorkspacePackageInfo) {
    const normalizedPackageRoot = normalizeFileKey(item.path);
    const rawPackageRoot = toPosixPath(path.resolve(item.path));
    return (
      normalizedPackageRoot === this.root || rawPackageRoot === this.rawRoot
    );
  }
}

const isPackageFile = (item: StylePackageInfo, normalizedFile: string) => {
  const packageRoot = normalizeFileKey(item.packageRoot);
  return (
    normalizedFile === packageRoot ||
    normalizedFile.startsWith(`${packageRoot}/`)
  );
};
