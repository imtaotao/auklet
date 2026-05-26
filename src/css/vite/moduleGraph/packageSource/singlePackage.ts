import fs from 'node:fs';
import path from 'node:path';
import {
  aukletConfigFiles,
  isAukletConfigFile,
  normalizeAukletConfig,
} from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { normalizeFileKey, toWatchPath } from '#auklet/utils';
import type {
  StylePackageInfo,
  StylePackageSource,
} from '#auklet/css/vite/moduleGraph/packageSource/types';
import type { LoadAukletConfig } from '#auklet/css/vite/moduleGraph/types';

export type SinglePackageSourceOptions = {
  root: string;
  styleExtensions: Array<string>;
  loadAukletConfig?: LoadAukletConfig;
};

export class SinglePackageSource implements StylePackageSource {
  private packageInfo?: StylePackageInfo;
  private readonly root: string;
  private readonly loadAukletConfig: LoadAukletConfig;

  constructor(private readonly options: SinglePackageSourceOptions) {
    this.root = normalizeFileKey(options.root);
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
  }

  getPackages() {
    return [this.getPackageInfo()];
  }

  getPackageNames() {
    return [this.getPackageInfo().packageName];
  }

  isKnownPackageName(packageName: string) {
    return packageName === this.getPackageInfo().packageName;
  }

  isSourceGraphFile(file: string) {
    const normalizedFile = normalizeFileKey(file);
    if (!this.isInsidePackage(normalizedFile)) return false;
    if (isAukletConfigFile(path.basename(normalizedFile))) return true;
    if (SOURCE_MODULE_RE.test(normalizedFile)) return true;

    return this.options.styleExtensions.some((extension) =>
      normalizedFile.endsWith(extension),
    );
  }

  async getWatchRoots() {
    const normalizedConfig = normalizeAukletConfig(
      await this.loadAukletConfig(this.root, { cacheBust: true }),
    );

    return [
      toWatchPath(this.root, normalizedConfig.source),
      ...aukletConfigFiles.map((file) => toWatchPath(this.root, file)),
    ];
  }

  private getPackageInfo() {
    if (this.packageInfo) return this.packageInfo;

    const packageJsonPath = path.join(this.root, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(
        `[auklet:css] package mode requires a package.json at ${this.root}.`,
      );
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
    };
    if (!pkg.name) {
      throw new Error(
        `[auklet:css] package mode requires package.json#name at ${this.root}.`,
      );
    }

    this.packageInfo = {
      packageName: pkg.name,
      packageRoot: this.root,
    };
    return this.packageInfo;
  }

  private isInsidePackage(file: string) {
    return file === this.root || file.startsWith(`${this.root}/`);
  }
}
