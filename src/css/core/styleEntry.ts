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

export function getGlobalStyleDependencies(cssOptions: NormalizedAukletConfig) {
  const dependencies: Array<string> = [];
  for (const [packageName, dependency] of Object.entries(
    cssOptions.styles.dependencies,
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

export function getExternalStyleDependencies(
  cssOptions: NormalizedAukletConfig,
) {
  return getGlobalStyleDependencies(cssOptions);
}

export function getThemeStyleDependencies(
  cssOptions: NormalizedAukletConfig,
  themeName: string,
) {
  const dependencies: Array<string> = [];
  for (const [packageName, dependency] of Object.entries(
    cssOptions.styles.dependencies,
  )) {
    const themeDependency = dependency.themes?.[themeName];
    if (!themeDependency) continue;
    dependencies.push(joinDependencySpecifier(packageName, themeDependency));
  }
  return dependencies;
}

export function getThemeStyleEntries(cssOptions: NormalizedAukletConfig) {
  return Object.entries(cssOptions.styles.themes).map(([themeName, file]) => ({
    themeName,
    file,
  }));
}

export function resolveThemeStyleFiles(
  cssOptions: NormalizedAukletConfig,
  packageRoot: string,
) {
  const themeFiles = new Map<string, string>();
  for (const { themeName, file } of getThemeStyleEntries(cssOptions)) {
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
