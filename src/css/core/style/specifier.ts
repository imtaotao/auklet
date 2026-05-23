import path from 'node:path';

export type PackageStyleSpecifier = {
  packageName: string;
  stylePath: string;
};

export function parsePackageStyleSpecifier(specifier: string) {
  if (specifier.startsWith('.')) return null;

  const parts = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? `${parts.shift() ?? ''}/${parts.shift() ?? ''}`
    : (parts.shift() ?? '');

  if (!packageName) return null;

  return {
    packageName,
    stylePath: parts.join('/'),
  } satisfies PackageStyleSpecifier;
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

export function removeStyleExtension(stylePath: string) {
  return stylePath.slice(0, -path.extname(stylePath).length);
}
