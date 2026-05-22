import type { PackageBuildOptions } from '#auklet/types';
import type { BuildContext, PackageJsonLike } from '#auklet/build/tsdown/types';
import { parseModuleId } from '#auklet/build/tsdown/parseModuleId';

const getExternal = (names: Array<string>) => {
  const external = new Set<string>();

  for (const name of names) {
    external.add(name);
    external.add(`${name}/*`);
  }
  return [...external];
};

const getDependencyGlobalName = (name: string) => {
  return name
    .replace(/^@/, '')
    .split(/[/-]/g)
    .filter(Boolean)
    .map((label) => label[0].toUpperCase() + label.slice(1))
    .join('');
};

export function getPackageExternal(
  pkg: PackageJsonLike,
  options: PackageBuildOptions,
) {
  return getExternal([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...(options.externals ?? []),
  ]);
}

export function getPeerExternal(
  pkg: PackageJsonLike,
  options: PackageBuildOptions,
) {
  return [
    ...new Set([
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...(options.externals ?? []),
    ]),
  ];
}

export function getIifeGlobals(context: BuildContext) {
  return {
    ...Object.fromEntries(
      context.peerExternal.map((name) => [name, getDependencyGlobalName(name)]),
    ),
    ...context.globals,
  };
}

// React 本体 external，jsx-runtime 这层小入口 bundle 进产物。
export function getIifeAlwaysBundle(context: BuildContext) {
  const warnedParseFailures = new Set<string>();
  const peerDependencies = new Set(context.peerExternal);
  const runtimeDependencies = new Set(context.runtimeDependencyNames);

  return (id: string) => {
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') {
      return peerDependencies.has('react');
    }
    try {
      id = parseModuleId(id).name;
    } catch (error) {
      if (!warnedParseFailures.has(id)) {
        warnedParseFailures.add(id);
        console.warn(
          `[auklet:build] Unable to parse module id for IIFE bundle dependency classification: ${id}`,
          error,
        );
      }
    }
    return peerDependencies.has(id) ? false : runtimeDependencies.has(id);
  };
}
