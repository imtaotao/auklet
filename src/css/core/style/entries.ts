import {
  getExternalStyleDependencies,
  getGlobalStyleDependencies,
  getThemeNames,
  getThemeStyleDependencies,
} from '#auklet/css/core/style/dependencies';
import { StyleModuleEntryPlanner } from '#auklet/css/core/styleModuleEntryPlanner';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import type { NormalizedAukletConfig } from '#auklet/types';

type StyleModulePart = { type: 'module' };
type StyleThemesPart = { type: 'themes'; themeNames: Array<string> };
type DependenciesPart = { type: 'dependencies'; specifiers: Array<string> };
type ThemePart = { type: 'theme'; themeName: string };

export type ExternalEntryPart = DependenciesPart;
export type ThemeEntryPart = DependenciesPart | ThemePart;
export type StyleEntryPart =
  | DependenciesPart
  | StyleThemesPart
  | StyleModulePart;

const dependenciesPart = (specifiers: Array<string>) =>
  ({ type: 'dependencies', specifiers }) satisfies DependenciesPart;

// 环境无关的 style entry graph。production writer 和 Vite/dev renderer 都从这里取入口语义。
export function createStyleEntryParts(config: NormalizedAukletConfig) {
  return [
    dependenciesPart(getGlobalStyleDependencies(config)),
    { type: 'themes', themeNames: getThemeNames(config) },
    { type: 'module' },
  ] satisfies Array<StyleEntryPart>;
}

export function createThemeEntryParts(
  config: NormalizedAukletConfig,
  themeName: string,
  options: { includeDependencies?: boolean } = {},
) {
  const themePart: ThemePart = { type: 'theme', themeName };

  if (options.includeDependencies === false) {
    return [themePart];
  }
  return [
    dependenciesPart(getThemeStyleDependencies(config, themeName)),
    themePart,
  ];
}

export function createExternalEntryParts(config: NormalizedAukletConfig) {
  return [
    dependenciesPart(getExternalStyleDependencies(config)),
  ] satisfies Array<ExternalEntryPart>;
}

export function collectModuleStyleImports(packageContext: StylePackageContext) {
  return packageContext.importCollector.collect(
    packageContext.sourceFiles,
    packageContext.normalizedConfig,
  );
}

export function createModuleStyleEntryPlan(
  packageContext: StylePackageContext,
  sourceDir: string,
) {
  return new StyleModuleEntryPlanner(packageContext).createEntry(
    sourceDir,
    collectModuleStyleImports(packageContext),
  );
}

export function createModuleStyleEntryPlans(
  packageContext: StylePackageContext,
) {
  return new StyleModuleEntryPlanner(packageContext).createEntries(
    collectModuleStyleImports(packageContext),
  );
}
