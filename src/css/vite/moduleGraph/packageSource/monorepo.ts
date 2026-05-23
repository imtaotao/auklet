import fs from 'node:fs';
import path from 'node:path';
import { aukletConfigFile } from '#auklet/config';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { normalizeFileKey, toWatchPath } from '#auklet/utils';
import type {
  StylePackageInfo,
  StylePackageSource,
} from '#auklet/css/vite/moduleGraph/packageSource/types';

export type MonorepoPackageSourceOptions = {
  root: string;
  packagesDir: string;
  styleExtensions: Array<string>;
};

export class MonorepoPackageSource implements StylePackageSource {
  private packages?: Array<StylePackageInfo>;
  private packageNames?: Array<string>;
  private readonly root: string;

  constructor(private readonly options: MonorepoPackageSourceOptions) {
    this.root = normalizeFileKey(options.root);
  }

  getPackages() {
    if (this.packages) return this.packages;

    const packagesRoot = path.join(this.root, this.options.packagesDir);
    if (!fs.existsSync(packagesRoot)) {
      this.packages = [];
      return this.packages;
    }

    this.packages = fs
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
    const packagesRoot = normalizeFileKey(
      path.join(this.root, this.options.packagesDir),
    );
    if (!normalizedFile.startsWith(`${packagesRoot}/`)) {
      return false;
    }
    if (normalizedFile.endsWith(aukletConfigFile)) return true;
    if (SOURCE_MODULE_RE.test(normalizedFile)) return true;

    return this.options.styleExtensions.some((extension) =>
      normalizedFile.endsWith(extension),
    );
  }

  async getWatchRoots() {
    const packagesRoot = path.join(this.root, this.options.packagesDir);
    return [
      toWatchPath(packagesRoot, '*', 'src'),
      toWatchPath(packagesRoot, '*', aukletConfigFile),
    ];
  }
}
