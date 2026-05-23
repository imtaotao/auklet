import path from 'node:path';
import { EXTERNAL_ENTRY, STYLE_ENTRY } from '#auklet/css/constants';
import { POSIX_SEPARATOR, toFsSpecifier, toPosixPath } from '#auklet/utils';

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

export function toRelativeImportSpecifier(fromDir: string, file: string) {
  const relative = toPosixPath(path.relative(fromDir, file));
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function getStylePathOutputFormat(
  stylePath: string,
  outputFormats: Array<string>,
) {
  for (const format of outputFormats) {
    const prefix = `${format}${POSIX_SEPARATOR}`;
    if (!stylePath.startsWith(prefix)) continue;
    return {
      format,
      path: stylePath.slice(prefix.length),
    };
  }
  return null;
}

export function createOutputStyleSpecifier(
  specifier: string,
  options: {
    currentOutputFormat: string;
    outputFormats: Array<string>;
  },
) {
  const parsed = parsePackageStyleSpecifier(specifier);
  if (!parsed) return specifier;

  const outputFormat = getStylePathOutputFormat(
    parsed.stylePath,
    options.outputFormats,
  );
  if (!outputFormat) return specifier;

  return [
    parsed.packageName,
    options.currentOutputFormat,
    outputFormat.path,
  ].join(POSIX_SEPARATOR);
}

export function createExternalStyleSpecifier(
  specifier: string,
  options: {
    currentOutputFormat: string;
    outputFormats: Array<string>;
    styleDir: string;
    indexStyleFile: string;
    externalStyleFile: string;
  },
) {
  const parsed = parsePackageStyleSpecifier(specifier);
  if (!parsed) return specifier;

  if (parsed.stylePath === STYLE_ENTRY) {
    return [parsed.packageName, options.externalStyleFile].join(
      POSIX_SEPARATOR,
    );
  }

  const outputFormat = getStylePathOutputFormat(
    parsed.stylePath,
    options.outputFormats,
  );
  const indexStylePath = [options.styleDir, options.indexStyleFile].join(
    POSIX_SEPARATOR,
  );
  if (!outputFormat || outputFormat.path !== indexStylePath) return specifier;

  return [
    parsed.packageName,
    options.currentOutputFormat,
    options.styleDir,
    options.externalStyleFile,
  ].join(POSIX_SEPARATOR);
}

export function createDevExternalStyleSpecifier(
  specifier: string,
  options: {
    isKnownPackageName: (packageName: string) => boolean;
    styleDir: string;
    indexStyleFile: string;
    externalStyleFile?: string;
  },
) {
  const parsed = parsePackageStyleSpecifier(specifier);
  if (!parsed) return specifier;
  if (!options.isKnownPackageName(parsed.packageName)) return specifier;

  const indexStylePath = [options.styleDir, options.indexStyleFile].join(
    POSIX_SEPARATOR,
  );
  if (parsed.stylePath === STYLE_ENTRY || parsed.stylePath === indexStylePath) {
    return [
      parsed.packageName,
      options.externalStyleFile ?? EXTERNAL_ENTRY,
    ].join(POSIX_SEPARATOR);
  }
  return specifier;
}

export function createOutputModuleStyleSpecifier(
  specifier: string,
  styleDir: string,
) {
  if (specifier.startsWith('.')) return specifier;
  if (!path.isAbsolute(specifier)) return specifier;
  return toRelativeImportSpecifier(styleDir, specifier);
}

export function createOutputOwnStyleSpecifier(
  options: {
    sourceRoot: string;
    outputRoot: string;
    styleDir: string;
  },
  styleFile: string,
) {
  return toRelativeImportSpecifier(
    options.styleDir,
    path.join(options.outputRoot, path.relative(options.sourceRoot, styleFile)),
  );
}

export function createDevModuleStyleSpecifier(
  specifier: string,
  options: {
    sourceStyleDir: string;
    sourceRoot: string;
    packageName: string;
    styleDir: string;
    indexStyleFile: string;
    mapExternalSpecifier: (specifier: string) => string;
  },
) {
  if (!specifier.startsWith('.')) {
    return options.mapExternalSpecifier(specifier);
  }

  const outputStyleEntry = path.resolve(options.sourceStyleDir, specifier);
  const styleEntrySuffix = `${path.sep}${options.styleDir}${path.sep}${options.indexStyleFile}`;
  if (!outputStyleEntry.endsWith(styleEntrySuffix)) {
    return toFsSpecifier(outputStyleEntry);
  }

  const sourceModuleDir = path.relative(
    options.sourceRoot,
    outputStyleEntry.slice(0, -styleEntrySuffix.length),
  );
  return `${options.packageName}/${toPosixPath(sourceModuleDir)}.css`;
}
