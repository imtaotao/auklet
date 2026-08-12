import fs from 'node:fs';
import path from 'node:path';
import type { PackageBuildOptions } from '#auklet/types';
import type { BuildContext, PackageJsonLike } from '#auklet/build/tsdown/types';
import {
  getPeerExternal,
  getPackageExternal,
} from '#auklet/build/tsdown/dependencies';

const getGlobalName = (pkg: PackageJsonLike) => {
  return (pkg?.name ?? '')
    .replace(/@/g, '')
    .split(/[/-]/g)
    .map((label) => label[0].toUpperCase() + label.slice(1))
    .join('');
};

const findWorkspaceTsconfig = (packageRoot: string) => {
  let current = packageRoot;

  while (true) {
    const tsconfig = path.join(current, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) return tsconfig;

    const parent = path.dirname(current);
    if (parent === current) return path.join(packageRoot, 'tsconfig.json');
    current = parent;
  }
};

export function createBuildContext(
  packageRoot: string,
  options: PackageBuildOptions,
  source: string,
  output: string,
) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as PackageJsonLike;

  const banner =
    options.banner ??
    '/*!\n' +
      ` * ${pkg.name}.js v${pkg.version}\n` +
      (pkg.author ? ` * (c) ${new Date().getFullYear()} ${pkg.author}\n` : '') +
      ' */';

  return {
    pkg,
    banner,
    packageRoot,
    source,
    output,
    runtimeDependencyNames: Object.keys(pkg.dependencies ?? {}),
    packageExternal: getPackageExternal(pkg, options),
    peerExternal: getPeerExternal(pkg, options),
    alias: options.alias ?? {},
    mainFields: options.mainFields,
    globals: options.globals ?? {},
    globalName: getGlobalName(pkg),
    platform: options.platform!,
    target: options.target!,
    configureTsdown: options.configureTsdown,
    tsconfig: options.tsconfig
      ? path.resolve(packageRoot, options.tsconfig)
      : findWorkspaceTsconfig(packageRoot),
  } satisfies BuildContext;
}
