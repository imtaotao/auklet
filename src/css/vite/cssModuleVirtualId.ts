import path from 'node:path';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { stripCssModuleQuery } from '#auklet/css/modules/resolveCssModuleImport';

const CSS_MODULE_LOCALS_SUFFIX = '.js';
const CSS_MODULE_STYLE_ASSET_SUFFIX = '.css';
const CSS_MODULE_ROOT_STYLE_SUFFIX = '.style.css';
const CSS_MODULE_VIRTUAL_PREFIX = '\0auklet-css-module:';
const CSS_MODULE_STYLE_ASSET_PREFIX = 'virtual:auklet-css-module-asset:';
const RESOLVED_CSS_MODULE_STYLE_ASSET_PREFIX = '\0auklet-css-module-asset:';

export function toCssModuleVirtualId(file: string) {
  return `${CSS_MODULE_VIRTUAL_PREFIX}${path.resolve(file)}${CSS_MODULE_LOCALS_SUFFIX}`;
}

export function toCssModuleStyleVirtualId(file: string) {
  return `${CSS_MODULE_VIRTUAL_PREFIX}${path.resolve(file)}${CSS_MODULE_ROOT_STYLE_SUFFIX}`;
}

export function toCssModuleVirtualIds(file: string) {
  const resolved = path.resolve(file);
  return [
    toCssModuleVirtualId(resolved),
    toCssModuleStyleVirtualId(resolved),
  ] as const;
}

const encodeStyleAssetId = (moduleFile: string, assetFile: string) => {
  const resolvedModule = path.resolve(moduleFile);
  const resolvedAsset = path.resolve(assetFile);
  return encodeURIComponent(JSON.stringify([resolvedModule, resolvedAsset]));
};

const decodeStyleAssetId = (id: string, prefix: string) => {
  const cleanId = stripCssModuleQuery(id);
  if (
    !cleanId.startsWith(prefix) ||
    !cleanId.endsWith(CSS_MODULE_STYLE_ASSET_SUFFIX)
  ) {
    return null;
  }

  try {
    const payload = cleanId.slice(
      prefix.length,
      -CSS_MODULE_STYLE_ASSET_SUFFIX.length,
    );
    const parsed = JSON.parse(decodeURIComponent(payload));

    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((item) => typeof item !== 'string')
    ) {
      return null;
    }
    return {
      moduleFile: path.resolve(parsed[0]),
      assetFile: path.resolve(parsed[1]),
    };
  } catch {
    return null;
  }
};

export function toCssModuleStyleAssetVirtualId(
  moduleFile: string,
  assetFile: string,
) {
  return `${CSS_MODULE_STYLE_ASSET_PREFIX}${encodeStyleAssetId(
    moduleFile,
    assetFile,
  )}${CSS_MODULE_STYLE_ASSET_SUFFIX}`;
}

export function toResolvedCssModuleStyleAssetVirtualId(
  moduleFile: string,
  assetFile: string,
) {
  return `${RESOLVED_CSS_MODULE_STYLE_ASSET_PREFIX}${encodeStyleAssetId(
    moduleFile,
    assetFile,
  )}${CSS_MODULE_STYLE_ASSET_SUFFIX}?direct&auklet-css-module-asset`;
}

export function toCssModuleStyleAssetBrowserUrl(
  moduleFile: string,
  assetFile: string,
) {
  const resolvedId = toResolvedCssModuleStyleAssetVirtualId(
    moduleFile,
    assetFile,
  );
  return `/@id/__x00__${resolvedId.slice(1)}`;
}

export function resolveCssModuleStyleAssetVirtualId(id: string) {
  const unwrappedId = id.startsWith('/@id/__x00__')
    ? `\0${id.slice('/@id/__x00__'.length)}`
    : id;
  const parsed =
    decodeStyleAssetId(unwrappedId, CSS_MODULE_STYLE_ASSET_PREFIX) ??
    decodeStyleAssetId(unwrappedId, RESOLVED_CSS_MODULE_STYLE_ASSET_PREFIX);

  if (!parsed) return null;
  return {
    ...parsed,
    id: toResolvedCssModuleStyleAssetVirtualId(
      parsed.moduleFile,
      parsed.assetFile,
    ),
  };
}

export function isCssModuleStyleAssetVirtualModuleId(
  id: string | null | undefined,
) {
  return Boolean(id && resolveCssModuleStyleAssetVirtualId(id));
}

const cssModuleRootFileFromVirtualId = (id: string, suffix: string) => {
  const cleanId = stripCssModuleQuery(id);
  if (
    !cleanId.startsWith(CSS_MODULE_VIRTUAL_PREFIX) ||
    !cleanId.endsWith(suffix)
  ) {
    return null;
  }
  const moduleFile = cleanId.slice(
    CSS_MODULE_VIRTUAL_PREFIX.length,
    -suffix.length,
  );
  return isCssModuleFile(moduleFile) ? path.resolve(moduleFile) : null;
};

export function isCssModuleRootStyleVirtualModuleId(
  id: string | null | undefined,
) {
  return Boolean(
    id && cssModuleRootFileFromVirtualId(id, CSS_MODULE_ROOT_STYLE_SUFFIX),
  );
}

export function isCssModuleLocalsVirtualModuleId(
  id: string | null | undefined,
) {
  return Boolean(
    id && cssModuleRootFileFromVirtualId(id, CSS_MODULE_LOCALS_SUFFIX),
  );
}

export function isCssModuleCssVirtualModuleId(id: string | null | undefined) {
  return (
    isCssModuleRootStyleVirtualModuleId(id) ||
    isCssModuleStyleAssetVirtualModuleId(id)
  );
}

export function isCssModuleVirtualModuleId(id: string | null | undefined) {
  return (
    isCssModuleLocalsVirtualModuleId(id) || isCssModuleCssVirtualModuleId(id)
  );
}

export function cssModuleFileFromVirtualId(id: string) {
  const styleAsset = resolveCssModuleStyleAssetVirtualId(id);
  if (styleAsset) return styleAsset.moduleFile;
  return (
    cssModuleRootFileFromVirtualId(id, CSS_MODULE_ROOT_STYLE_SUFFIX) ??
    cssModuleRootFileFromVirtualId(id, CSS_MODULE_LOCALS_SUFFIX)
  );
}
