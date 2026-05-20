import path from 'node:path';
import { isArray } from 'aidly';
import type { NormalizedAukletConfig } from '#auklet/types';
import { getSourceModuleDir } from '#auklet/utils';
import { normalizeCssFileKey } from '#auklet/css/core/path';

export const STYLE_ENTRY = 'style.css';
export const EXTERNAL_ENTRY = 'external.css';
export const MODULE_ENTRY = 'module.css';
export const THEMES_DIR = 'themes';
export const THEMES_ENTRY_PREFIX = 'themes/';

export type PackageStyleSpecifier = {
  packageName: string;
  stylePath: string;
};

export function groupStyleFilesByDir(
  sourceRoot: string,
  styleFiles: Array<string>,
) {
  const styleFilesByDir = new Map<string, Array<string>>();
  for (const styleFile of styleFiles) {
    const sourceRelative = path.relative(sourceRoot, styleFile);
    const sourceDir = getSourceModuleDir(sourceRelative);
    const values = styleFilesByDir.get(sourceDir) ?? [];
    values.push(styleFile);
    styleFilesByDir.set(sourceDir, values);
  }
  return styleFilesByDir;
}

export function getGlobalStyleDependencies(config: NormalizedAukletConfig) {
  const dependencies: Array<string> = [];
  for (const [packageName, dependency] of Object.entries(
    config.styles.dependencies,
  )) {
    const globalDependencies = isArray(dependency.entry)
      ? dependency.entry
      : [dependency.entry].filter((value): value is string => Boolean(value));

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

export function createStyleFileKeySet(styleFiles: Iterable<string>) {
  return new Set(Array.from(styleFiles, normalizeCssFileKey));
}

export function createStyleFileKey(styleFile: string) {
  return normalizeCssFileKey(styleFile);
}

export function parsePackageStyleSpecifier(
  specifier: string,
): PackageStyleSpecifier | null {
  if (specifier.startsWith('.')) return null;

  const parts = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? `${parts.shift() ?? ''}/${parts.shift() ?? ''}`
    : parts.shift() ?? '';

  if (!packageName) return null;

  return {
    packageName,
    stylePath: parts.join('/'),
  };
}

export function joinDependencySpecifier(
  packageName: string,
  dependencyPath: string,
) {
  if (!dependencyPath) return packageName;
  return dependencyPath.startsWith('/')
    ? `${packageName}${dependencyPath}`
    : `${packageName}/${dependencyPath}`;
}

export function createImportCode(specifiers: Array<string>) {
  return Array.from(new Set(specifiers))
    .map((specifier) => `@import "${specifier}";`)
    .join('\n');
}

export function removeCssExtension(cssPath: string) {
  return cssPath.slice(0, -path.extname(cssPath).length);
}
