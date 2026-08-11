import fs from 'node:fs';
import path from 'node:path';
import type { EnvironmentModuleGraph, EnvironmentModuleNode } from 'vite';
import { tryResolveExternalLessFile } from '#auklet/css/core/resolvers/externalLess';
import { stripCssModuleQuery } from '#auklet/css/modules/resolveCssModuleImport';
import {
  dedupeModuleNodes,
  type ModuleGraphLookup,
} from '#auklet/css/vite/hmr/propagate';
import { VirtualDependencyTracker } from '#auklet/css/vite/hmr/tracker';
import { normalizeFileKey } from '#auklet/utils';

const LESS_IMPORT_RE = /@import\s*(?:\([^)]*\)\s*)?['"]([^'"]+)['"]/g;

// Vite Less only addWatchFile()s @import deps — no importer edge in the module
// graph. FileManager remaps package imports via tryResolveExternalLessFile
// (same resolveExternalLessImport as production Less / shared.output remap).
// HMR tracks only concrete entry `.less` paths (Less options.filename). When
// that is missing (common on first paint), hotUpdate falls back to scanning
// loaded `.less` sources for `@import` of the changed file.
//
// Never return the changed Less partial itself as the sole hotUpdate boundary
// (dead-end → full-reload, which package CSS HMR then suppresses).

export class LessImportTracker {
  private readonly deps = new VirtualDependencyTracker();

  // Importer must be a real .less file id (not Vite's `${dir}/*` pseudo path).
  track(resolvedFile: string, importerFile: string) {
    const clean = stripCssModuleQuery(importerFile);
    if (path.basename(clean) === '*' || !/\.less$/i.test(clean)) return;
    this.deps.track(path.resolve(resolvedFile), path.resolve(clean));
  }

  listTrackIds(file: string) {
    return this.deps.listVirtualIds(file);
  }

  pruneStale(moduleGraph: ModuleGraphLookup) {
    this.deps.pruneStale(moduleGraph);
  }
}

const moduleStyleCandidate = (module: EnvironmentModuleNode) => {
  const moduleId = module.id;
  if (module.file) return module.file;
  if (moduleId && !moduleId.startsWith('\0')) {
    return moduleId.split('?', 1)[0] ?? '';
  }
  return '';
};

const resolveViteRootHint = (moduleGraph: ModuleGraphLookup) => {
  const idToModuleMap = (moduleGraph as EnvironmentModuleGraph).idToModuleMap;
  if (!idToModuleMap) return null;
  for (const module of idToModuleMap.values()) {
    const file = module.file;
    const url = module.url?.split('?', 1)[0] ?? '';
    if (!file || !url.startsWith('/') || url.startsWith('/@')) continue;
    const urlRel = url.slice(1);
    const fileKey = normalizeFileKey(file);
    if (!fileKey.endsWith(urlRel)) continue;
    return path.resolve(file.slice(0, -urlRel.length));
  }
  return null;
};

const resolveAbsFromBrowserUrl = (url: string, viteRoot: string | null) => {
  if (
    !viteRoot ||
    !url.startsWith('/') ||
    url.startsWith('/@') ||
    !/\.less$/i.test(url)
  ) {
    return null;
  }
  return path.resolve(viteRoot, url.slice(1));
};

const lessSourceImportsFile = (importerFile: string, changedFile: string) => {
  let code = '';
  try {
    code = fs.readFileSync(importerFile, 'utf8');
  } catch {
    return false;
  }
  if (!/@import\b/.test(code)) return false;

  const changedKey = normalizeFileKey(changedFile);
  const importerDir = path.dirname(importerFile);

  for (const match of code.matchAll(LESS_IMPORT_RE)) {
    const specifier = match[1] ?? '';
    if (!specifier) continue;

    if (specifier.startsWith('.')) {
      const abs = path.resolve(importerDir, specifier);
      if (normalizeFileKey(abs) === changedKey) return true;
      continue;
    }

    // Same resolve as viteLessPlugin / production external Less
    // (exports → published .less, workspace shared.output → source).
    const resolved = tryResolveExternalLessFile(specifier, importerDir);
    if (resolved && normalizeFileKey(resolved) === changedKey) return true;
  }

  return false;
};

const resolveModuleLessFile = (
  module: EnvironmentModuleNode,
  viteRoot: string | null,
) => {
  const candidate = moduleStyleCandidate(module);
  if (candidate && !candidate.startsWith('\0') && /\.less$/i.test(candidate)) {
    const abs = path.resolve(candidate);
    // Browser module ids look like `/src/foo.less` — only trust when on disk.
    if (fs.existsSync(abs)) return abs;
  }
  const url = module.url?.split('?', 1)[0] ?? '';
  return resolveAbsFromBrowserUrl(url, viteRoot);
};

// Fallback when FileManager did not record options.filename (common after
// cold start): scan loaded less sources for @import of the changed file.
export function collectLessImportersBySourceScan(options: {
  file: string;
  moduleGraph: ModuleGraphLookup;
}) {
  if (!/\.less$/i.test(options.file)) return [] as Array<EnvironmentModuleNode>;
  const idToModuleMap = (options.moduleGraph as EnvironmentModuleGraph)
    .idToModuleMap;
  if (!idToModuleMap) return [] as Array<EnvironmentModuleNode>;

  const changedKey = normalizeFileKey(options.file);
  const viteRoot = resolveViteRootHint(options.moduleGraph);
  const modules: Array<EnvironmentModuleNode> = [];

  for (const module of idToModuleMap.values()) {
    const abs = resolveModuleLessFile(module, viteRoot);
    if (!abs || normalizeFileKey(abs) === changedKey) continue;
    if (!fs.existsSync(abs)) continue;
    if (!lessSourceImportsFile(abs, options.file)) continue;
    modules.push(module);
  }

  return dedupeModuleNodes(modules);
}

export function collectViteLessImporterHotUpdateModules(options: {
  tracker: LessImportTracker;
  file: string;
  moduleGraph: ModuleGraphLookup;
}) {
  const modules: Array<EnvironmentModuleNode> = [];
  for (const trackId of options.tracker.listTrackIds(options.file)) {
    const module = options.moduleGraph.getModuleById(trackId);
    if (module) {
      modules.push(module);
      continue;
    }
    const byFile = (
      options.moduleGraph as EnvironmentModuleGraph
    ).getModulesByFile?.(trackId);
    if (byFile) modules.push(...byFile);
  }

  const tracked = dedupeModuleNodes(modules);
  if (tracked.length) return tracked;

  return collectLessImportersBySourceScan({
    file: options.file,
    moduleGraph: options.moduleGraph,
  });
}

// Drop the changed partial itself from Vite's getModulesByFile list — it is
// rarely an HMR boundary and forces full-reload when mixed with auklet updates.
export function filterSafeViteNativeHotUpdateModules(options: {
  file: string;
  modules: Array<EnvironmentModuleNode>;
}) {
  const fileKey = normalizeFileKey(options.file);
  return options.modules.filter((mod) => {
    const candidate = moduleStyleCandidate(mod);
    if (!candidate || candidate.startsWith('\0')) return true;
    return normalizeFileKey(candidate) !== fileKey;
  });
}
