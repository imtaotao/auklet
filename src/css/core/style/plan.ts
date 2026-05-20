import type { NormalizedAukletConfig } from '#auklet/types';
import {
  getExternalStyleDependencies,
  getGlobalStyleDependencies,
  getThemeNames,
  getThemeStyleDependencies,
} from '#auklet/css/core/style/dependencies';

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
  ({ type: 'dependencies', specifiers } satisfies DependenciesPart);

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
  const themePart = { type: 'theme', themeName } satisfies ThemePart;

  if (options.includeDependencies === false) {
    return [themePart] satisfies Array<ThemeEntryPart>;
  }

  return [
    dependenciesPart(getThemeStyleDependencies(config, themeName)),
    themePart,
  ] satisfies Array<ThemeEntryPart>;
}

export function createExternalEntryParts(config: NormalizedAukletConfig) {
  return [
    dependenciesPart(getExternalStyleDependencies(config)),
  ] satisfies Array<ExternalEntryPart>;
}
