import path from 'node:path';
import {
  mapPreservedLessImportToCssSpecifier,
  parseLessSourceImports,
} from '#auklet/css/core/lessImportGraph';
import {
  findPackageRootForFile,
  readPackageName,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { isInsideRoot, toPosixPath } from '#auklet/utils';

// Cross-package sibling plain CSS assets (and local compiled Less→CSS) emitted
// next to compiled Modules. Cross-package .less uses (reference), not this path.
export const SHARED_PACKAGE_STYLE_OUTPUT_PREFIX = 'shared-package';

// Compiled CSS Modules must not keep a `*.module.css` name: Vite / webpack treat
// that pattern as CSS Modules and would re-hash class names while the JS shim
// still exports the producer locals.
export const COMPILED_CSS_MODULE_SCOPED_SUFFIX = '.scoped.css';

export function toCompiledCssModuleAssetRelative(fileOrRelative: string) {
  return toPosixPath(
    fileOrRelative.replace(
      /\.module\.(css|less)$/i,
      COMPILED_CSS_MODULE_SCOPED_SUFFIX,
    ),
  );
}

export function isCompiledCssModuleScopedCssFile(file: string) {
  return file.toLowerCase().endsWith(COMPILED_CSS_MODULE_SCOPED_SUFFIX);
}

const toOutputAssetRelative = (file: string, relativePath: string) => {
  if (isCssModuleFile(file)) {
    return toCompiledCssModuleAssetRelative(relativePath);
  }
  return toPosixPath(relativePath.replace(/\.less$/i, '.css'));
};

export function toCssModuleOutputFileName(options: {
  file: string;
  sourceRoot: string;
  consumerPackageRoot: string;
}) {
  const relative = path.relative(options.sourceRoot, options.file);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return toOutputAssetRelative(options.file, relative);
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
        toOutputAssetRelative(options.file, providerRelative),
      ),
    );
  }

  if (isInsideRoot(options.file, options.consumerPackageRoot)) {
    return toOutputAssetRelative(options.file, path.basename(options.file));
  }

  return toOutputAssetRelative(options.file, path.basename(options.file));
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
