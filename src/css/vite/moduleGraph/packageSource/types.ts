export type StylePackageInfo = {
  packageName: string;
  packageRoot: string;
};

export interface StylePackageSource {
  getPackages(): Array<StylePackageInfo>;
  getPackageNames(): Array<string>;
  isKnownPackageName(packageName: string): boolean;
  isSourceGraphFile(file: string): boolean;
  getWatchRoots(): Array<string>;
}
