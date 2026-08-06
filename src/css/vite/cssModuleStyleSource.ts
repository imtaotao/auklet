import path from 'node:path';
import {
  mapPreservedLessImportToCssSpecifier,
  parseLessSourceImports,
  type LessSourceImport,
} from '#auklet/css/core/lessImportGraph';
import type {
  CssModuleResult,
  CssModuleStyleAsset,
} from '#auklet/css/modules/compileCssModule';
import { toCssModuleStyleAssetBrowserUrl } from '#auklet/css/vite/cssModuleVirtualId';
import { normalizeFileKey } from '#auklet/utils';

const normalizeImportSpecifier = (specifier: string) =>
  specifier.replace(/^\.\//, '');

const findImportedAsset = (
  parsed: LessSourceImport,
  importerFile: string,
  styleAssets: Array<CssModuleStyleAsset>,
) => {
  const normalizedSpecifier = normalizeImportSpecifier(parsed.specifier);
  return (
    styleAssets.find((asset) => {
      const expected = mapPreservedLessImportToCssSpecifier(
        asset.file,
        importerFile,
      );
      return normalizeImportSpecifier(expected) === normalizedSpecifier;
    }) ?? null
  );
};

const createImportRule = (parsed: LessSourceImport, specifier: string) => {
  const options = parsed.options ? ` (${parsed.options})` : '';
  const tail = parsed.tail ? ` ${parsed.tail}` : '';
  return `@import${options} ${parsed.quote}${specifier}${parsed.quote}${tail};`;
};

const rewriteStyleAssetImports = (
  source: string,
  importerFile: string,
  moduleFile: string,
  styleAssets: Array<CssModuleStyleAsset>,
) => {
  let result = source;
  for (const parsed of [...parseLessSourceImports(source)].reverse()) {
    const importedAsset = findImportedAsset(parsed, importerFile, styleAssets);
    if (!importedAsset) continue;
    const virtualId = toCssModuleStyleAssetBrowserUrl(
      moduleFile,
      importedAsset.file,
    );
    result =
      result.slice(0, parsed.start) +
      createImportRule(parsed, virtualId) +
      result.slice(parsed.end);
  }
  return result;
};

export function createCssModuleDevStyleSource(
  moduleFile: string,
  result: CssModuleResult,
  assetFile?: string,
) {
  const resolvedModule = path.resolve(moduleFile);
  if (!assetFile) {
    return rewriteStyleAssetImports(
      result.css,
      resolvedModule,
      resolvedModule,
      result.styleAssets,
    );
  }

  const resolvedAsset = path.resolve(assetFile);
  const asset = result.styleAssets.find(
    (item) => normalizeFileKey(item.file) === normalizeFileKey(resolvedAsset),
  );
  if (!asset) {
    throw new Error(
      `[css] CSS Modules virtual style asset not found: ${resolvedAsset} from ${resolvedModule}`,
    );
  }
  return rewriteStyleAssetImports(
    asset.css,
    resolvedAsset,
    resolvedModule,
    result.styleAssets,
  );
}
