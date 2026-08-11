import path from 'node:path';
import {
  mapPreservedLessImportToCssSpecifier,
  parseLessSourceImports,
} from '#auklet/css/core/lessImportGraph';
import {
  findPackageRootForFile,
  readPackageName,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import { isInsideRoot, toPosixPath } from '#auklet/utils';

// Cross-package sibling plain CSS assets (and local compiled Less→CSS) emitted
// next to compiled Modules. Cross-package .less uses (reference), not this path.
export const SHARED_PACKAGE_STYLE_OUTPUT_PREFIX = 'shared-package';

export function toCssModuleOutputFileName(options: {
  file: string;
  sourceRoot: string;
  consumerPackageRoot: string;
}) {
  const relative = path.relative(options.sourceRoot, options.file);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return toPosixPath(relative.replace(/\.less$/i, '.css'));
  }

  // Prefer provider package identity over "inside consumer root" so nested
  // node_modules / workspace links still land under shared-package/<pkg>/.
  const providerRoot = findPackageRootForFile(options.file);
  const consumerRoot = path.resolve(options.consumerPackageRoot);
  if (providerRoot && path.resolve(providerRoot) !== consumerRoot) {
    const packageName = readPackageName(providerRoot) ?? 'external';
    const providerRelative = toPosixPath(
      path.relative(providerRoot, options.file),
    );
    return toPosixPath(
      path.posix.join(
        SHARED_PACKAGE_STYLE_OUTPUT_PREFIX,
        packageName,
        providerRelative.replace(/\.less$/i, '.css'),
      ),
    );
  }

  if (isInsideRoot(options.file, options.consumerPackageRoot)) {
    return path.basename(options.file).replace(/\.less$/i, '.css');
  }

  return path.basename(options.file).replace(/\.less$/i, '.css');
}

export function toCssModuleOutputImportPath(
  fromFileName: string,
  toFileName: string,
) {
  const relative = toPosixPath(
    path.posix.relative(path.posix.dirname(fromFileName), toFileName),
  );
  if (!relative || relative === '.') {
    return `./${path.posix.basename(toFileName)}`;
  }
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function rewriteCssModuleOutputImportSpecifiers(options: {
  css: string;
  importerFile: string;
  importerOutputFileName?: string;
  styleAssets: Array<{ file: string }>;
  sourceRoot: string;
  consumerPackageRoot: string;
}) {
  if (!options.styleAssets.length) return options.css;

  const importerOut =
    options.importerOutputFileName ??
    toCssModuleOutputFileName({
      file: options.importerFile,
      sourceRoot: options.sourceRoot,
      consumerPackageRoot: options.consumerPackageRoot,
    });
  let result = options.css;
  for (const parsed of [...parseLessSourceImports(options.css)].reverse()) {
    if (!parsed.specifier.startsWith('.')) continue;
    const asset = options.styleAssets.find((item) => {
      const expected = mapPreservedLessImportToCssSpecifier(
        item.file,
        options.importerFile,
      );
      return expected === parsed.specifier;
    });
    if (!asset) continue;
    const assetOut = toCssModuleOutputFileName({
      file: asset.file,
      sourceRoot: options.sourceRoot,
      consumerPackageRoot: options.consumerPackageRoot,
    });
    const nextSpecifier = toCssModuleOutputImportPath(importerOut, assetOut);
    if (nextSpecifier === parsed.specifier) continue;
    const importOptions = parsed.options ? ` (${parsed.options})` : '';
    const tail = parsed.tail ? ` ${parsed.tail}` : '';
    const rewritten = `@import${importOptions} ${parsed.quote}${nextSpecifier}${parsed.quote}${tail};`;
    result =
      result.slice(0, parsed.start) + rewritten + result.slice(parsed.end);
  }
  return result;
}
