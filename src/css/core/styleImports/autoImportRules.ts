import { isArray } from 'aidly';
import type { NormalizedAukletConfig } from '#auklet/types';
import { joinDependencySpecifier } from '#auklet/css/core/style/specifier';
import { POSIX_SEPARATOR } from '#auklet/utils';

const GLOBSTAR_TOKEN = '**';

export type StyleAutoImportRule = {
  packageName: string;
  outputPattern: string;
};

export type StyleAutoImportRuleMatch = {
  rule: StyleAutoImportRule;
  values: Array<string>;
};

export function createStyleAutoImportRules(config: NormalizedAukletConfig) {
  const rules: Array<StyleAutoImportRule> = [];
  for (const [packageName, dependency] of Object.entries(
    config.styles.dependencies,
  )) {
    const dependencyPaths = isArray(dependency.components)
      ? dependency.components
      : dependency.components
        ? [dependency.components]
        : [];

    for (const dependencyPath of dependencyPaths) {
      rules.push({
        packageName,
        outputPattern: joinDependencySpecifier(packageName, dependencyPath),
      });
    }
  }
  return rules;
}

export function matchStyleAutoImportRules(
  rules: Array<StyleAutoImportRule>,
  importPath: string,
) {
  const matches: Array<StyleAutoImportRuleMatch> = [];

  for (const rule of rules) {
    if (
      importPath !== rule.packageName &&
      !importPath.startsWith(`${rule.packageName}${POSIX_SEPARATOR}`)
    ) {
      continue;
    }
    matches.push({
      rule,
      values: getImportPathValues(rule.packageName, importPath),
    });
  }
  return matches;
}

export function createStyleAutoImportSpecifier(
  rule: StyleAutoImportRule,
  values: Array<string>,
  importedName: string,
) {
  const pathValues = [...values];
  return rule.outputPattern.replace(/\*\*|\*/g, (token) => {
    const matchedValue = pathValues.shift();
    if (matchedValue) return matchedValue;
    if (token === GLOBSTAR_TOKEN) return importedName;
    return matchedValue ?? importedName;
  });
}

export function createDirectStyleAutoImportSpecifier(
  rule: StyleAutoImportRule,
  importPath: string,
) {
  const wildcardIndex = rule.outputPattern.indexOf('*');
  if (wildcardIndex < 0) {
    return null;
  }
  const wildcardLength = rule.outputPattern.startsWith(
    GLOBSTAR_TOKEN,
    wildcardIndex,
  )
    ? GLOBSTAR_TOKEN.length
    : 1;
  const prefix = rule.outputPattern.slice(0, wildcardIndex);
  const suffix = rule.outputPattern.slice(wildcardIndex + wildcardLength);

  if (!importPath.startsWith(prefix)) {
    return null;
  }
  return `${importPath}${suffix}`;
}

const getImportPathValues = (packageName: string, importPath: string) => {
  return importPath
    .slice(packageName.length)
    .replace(new RegExp(`^${POSIX_SEPARATOR}`), '')
    .split(POSIX_SEPARATOR)
    .filter(Boolean);
};
