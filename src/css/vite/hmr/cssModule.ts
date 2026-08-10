import path from 'node:path';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { normalizeFileKey } from '#auklet/utils';
import {
  cssModuleFileFromVirtualId,
  isCssModuleStyleAssetVirtualModuleId,
  resolveCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/cssModuleVirtualId';
import {
  CssModuleDevCompileCache,
  sameCssModuleLocals,
} from '#auklet/css/vite/hmr/cssModuleCompileCache';
import {
  collectVirtualHotUpdateModules,
  prepareCssModuleHotUpdateGraph,
  resolveVirtualModuleNode,
  type ModuleGraphLookup,
} from '#auklet/css/vite/hmr/propagate';
import type { VirtualDependencyTracker } from '#auklet/css/vite/hmr/tracker';

export {
  cssModuleFileFromVirtualId,
  isCssModuleLocalsVirtualModuleId,
  isCssModuleRootStyleVirtualModuleId as isCssModuleStyleVirtualModuleId,
  isCssModuleStyleAssetVirtualModuleId,
  resolveCssModuleStyleAssetVirtualId,
  toCssModuleStyleAssetBrowserUrl,
  toCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
  toCssModuleVirtualIds,
  toResolvedCssModuleStyleAssetVirtualId,
} from '#auklet/css/vite/cssModuleVirtualId';

const collectAffectedCssModuleFiles = (options: {
  tracker: VirtualDependencyTracker;
  file: string;
  moduleGraph: ModuleGraphLookup;
}) => {
  const affectedByModule = new Map<
    string,
    {
      moduleFile: string;
      assetVirtualIds: Set<string>;
    }
  >();

  const addModule = (moduleFile: string) => {
    const key = normalizeFileKey(moduleFile);
    let affected = affectedByModule.get(key);
    if (!affected) {
      affected = {
        moduleFile: path.resolve(moduleFile),
        assetVirtualIds: new Set(),
      };
      affectedByModule.set(key, affected);
    }
    return affected;
  };

  for (const virtualId of options.tracker.getLiveVirtualIds(
    options.file,
    options.moduleGraph,
  )) {
    const moduleFile = cssModuleFileFromVirtualId(virtualId);
    if (!moduleFile) continue;
    const affected = addModule(moduleFile);
    if (isCssModuleStyleAssetVirtualModuleId(virtualId)) {
      affected.assetVirtualIds.add(virtualId);
    }
  }

  if (isCssModuleFile(options.file)) {
    addModule(options.file);
  }

  return Array.from(affectedByModule.values());
};

const shouldUseHotUpdateRead = (changedFile: string, moduleFile: string) =>
  normalizeFileKey(changedFile) === normalizeFileKey(moduleFile);

export async function planCssModuleHotUpdate(options: {
  tracker: VirtualDependencyTracker;
  file: string;
  moduleGraph: ModuleGraphLookup;
  compileCache: CssModuleDevCompileCache;
  resolveSourceRoot: (file: string) => Promise<string | null | undefined>;
  resolvePackageRoot?: (file: string) => string | null | undefined;
  read?: () => string | Promise<string>;
}) {
  const affectedModules = collectAffectedCssModuleFiles(options);
  if (!affectedModules.length) return [];

  const virtualIds: Array<string> = [];

  for (const { moduleFile, assetVirtualIds } of affectedModules) {
    const styleVirtualId = toCssModuleStyleVirtualId(moduleFile);
    if (!resolveVirtualModuleNode(options.moduleGraph, styleVirtualId)) {
      continue;
    }

    const previousLocals = options.compileCache.peekLocals(moduleFile);
    const read = shouldUseHotUpdateRead(options.file, moduleFile)
      ? options.read
      : undefined;
    const result = await options.compileCache.compile(moduleFile, {
      packageRoot: options.resolvePackageRoot?.(moduleFile) ?? undefined,
      sourceRoot: (await options.resolveSourceRoot(moduleFile)) ?? undefined,
      force: true,
      read,
    });

    virtualIds.push(styleVirtualId);
    const currentAssetFiles = new Set(
      result.styleAssets.map((asset) => normalizeFileKey(asset.file)),
    );
    for (const assetVirtualId of assetVirtualIds) {
      const parsed = resolveCssModuleStyleAssetVirtualId(assetVirtualId);
      if (
        parsed &&
        currentAssetFiles.has(normalizeFileKey(parsed.assetFile)) &&
        resolveVirtualModuleNode(options.moduleGraph, assetVirtualId)
      ) {
        virtualIds.push(assetVirtualId);
      }
    }

    const localsVirtualId = toCssModuleVirtualId(moduleFile);
    if (
      (previousLocals === null ||
        !sameCssModuleLocals(previousLocals, result.locals)) &&
      resolveVirtualModuleNode(options.moduleGraph, localsVirtualId)
    ) {
      virtualIds.push(localsVirtualId);
    }
  }

  return virtualIds;
}

export function collectCssModuleHotUpdateModules(options: {
  moduleGraph: ModuleGraphLookup;
  virtualIds: Array<string>;
}) {
  if (!options.virtualIds.length) {
    return [];
  }

  const modules = collectVirtualHotUpdateModules({
    moduleGraph: options.moduleGraph,
    virtualIds: options.virtualIds,
  });
  prepareCssModuleHotUpdateGraph(modules);
  return modules;
}
