import path from 'node:path';
import { isArray } from 'aidly';
import type { NormalizedAukletConfig } from '#auklet/types';
import { joinDependencySpecifier } from '#auklet/css/core/style/specifier';

export function getGlobalStyleDependencies(config: NormalizedAukletConfig) {
  const dependencies: Array<string> = [];
  for (const [packageName, dependency] of Object.entries(
    config.styles.dependencies,
  )) {
    const globalDependencies = isArray(dependency.entry)
      ? dependency.entry
      : dependency.entry
      ? [dependency.entry]
      : [];

    for (const globalDependency of globalDependencies) {
      dependencies.push(joinDependencySpecifier(packageName, globalDependency));
    }
  }
  return dependencies;
}

export function getExternalStyleDependencies(config: NormalizedAukletConfig) {
  return getGlobalStyleDependencies(config);
}

export function getThemeStyleDependencies(
  config: NormalizedAukletConfig,
  themeName: string,
) {
  const dependencies: Array<string> = [];
  for (const [packageName, dependency] of Object.entries(
    config.styles.dependencies,
  )) {
    const themeDependency = dependency.themes?.[themeName];
    if (!themeDependency) continue;
    dependencies.push(joinDependencySpecifier(packageName, themeDependency));
  }
  return dependencies;
}

export function getThemeNames(config: NormalizedAukletConfig) {
  const names = new Set(Object.keys(config.styles.themes));

  for (const dependency of Object.values(config.styles.dependencies)) {
    for (const themeName of Object.keys(dependency.themes ?? {})) {
      names.add(themeName);
    }
  }
  return [...names];
}

export function getThemeStyleEntries(config: NormalizedAukletConfig) {
  return Object.entries(config.styles.themes).map(([themeName, file]) => ({
    themeName,
    file,
  }));
}

export function resolveThemeStyleFiles(
  config: NormalizedAukletConfig,
  packageRoot: string,
) {
  const themeFiles = new Map<string, string>();
  for (const { themeName, file } of getThemeStyleEntries(config)) {
    themeFiles.set(themeName, path.resolve(packageRoot, file));
  }
  return themeFiles;
}
