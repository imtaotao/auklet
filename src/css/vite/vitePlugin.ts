import fs from 'node:fs';
import type {
  DevEnvironment,
  HotUpdateOptions,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
} from 'vite';
import {
  loadPackageStyleCss,
  resolvePlainPackageStyleFile,
} from '#auklet/css/core/packageStyleSource';
import {
  findPackageRootForFile,
  isExternalPackageSpecifier,
} from '#auklet/css/core/resolvers/externalLess';
import {
  isCssModuleSpecifier,
  isPlainStyleSpecifier,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import { createCssModuleLocalsViteLoadCode } from '#auklet/css/modules/compileCssModule';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  resolveCssModuleImport,
  stripCssModuleQuery,
} from '#auklet/css/modules/resolveCssModuleImport';
import {
  invalidateWorkspaceSharedOutputResolveCache,
  resolveWorkspaceSharedOutputModule,
  resolveWorkspaceSharedOutputPlainStyle,
} from '#auklet/css/modules/resolveWorkspaceSharedOutputModule';
import { createCssModuleDevStyleSource } from '#auklet/css/vite/cssModuleStyleSource';
import {
  cssModuleFileFromVirtualId,
  isCssModuleRootStyleVirtualModuleId,
  resolveCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/cssModuleVirtualId';
import { invalidateModuleInEnvironments } from '#auklet/css/vite/hmr/propagate';
import type { ModuleStyleGraphOptions } from '#auklet/css/vite/moduleGraph/types';
import { AukletStyleHmr } from '#auklet/css/vite/hmr/styleHmr';
import { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import {
  fromPackageStyleVirtualId,
  toPackageStyleVirtualId,
} from '#auklet/css/vite/packageStyleVirtualId';
import { createAukletViteLessPlugin } from '#auklet/css/vite/viteLessPlugin';
import { createAukletLogger } from '#auklet/logger';
import { findWorkspaceRoot } from '#auklet/workspace/root';

const VIRTUAL_ID_PREFIX = 'virtual:auklet-css:';
const RESOLVED_VIRTUAL_ID_PREFIX = '\0auklet-css:';
const RESOLVED_CSS_MODULE_PREFIX = '\0auklet-css-module:';
const BROWSER_VIRTUAL_ID_PREFIX = 'auklet-css:';
// All auklet Vite virtual ids share this prefix (`auklet-css*`, `auklet-package-style:`).
const AUKLET_VIRTUAL_ID_PREFIX = '\0auklet-';
const logger = createAukletLogger({ scope: 'css:vite' });

const fromCssModuleVirtualId = cssModuleFileFromVirtualId;

// Module Federation and other plugins use `\0…` virtual ids. Those must not be
// treated as filesystem paths (Node fs APIs reject null bytes).
const isForeignViteVirtualId = (id: string) =>
  id.startsWith('\0') && !id.startsWith(AUKLET_VIRTUAL_ID_PREFIX);

// Owned virtual importers embed a real file; unwrap before package-root walks.
const resolveImporterAnchorFile = (importer: string) => {
  const cleanImporter = stripCssModuleQuery(importer);
  return (
    fromCssModuleVirtualId(cleanImporter) ??
    fromPackageStyleVirtualId(cleanImporter) ??
    (cleanImporter.startsWith('\0') ? null : cleanImporter)
  );
};

const loadCssModuleCode = async (
  context: { addWatchFile?: (file: string) => void },
  virtualId: string,
  moduleFile: string,
  hmr: AukletStyleHmr,
  graph: ModuleStyleGraph,
  environment = 'client',
) => {
  const sourceRoot = await graph.resolveSourceRootForFile(moduleFile);
  const packageRoot = graph.resolvePackageRootForFile(moduleFile);
  const result = await hmr.compileCssModuleForDev(
    moduleFile,
    sourceRoot ?? undefined,
    environment,
    packageRoot ?? undefined,
  );
  for (const file of result.watchFiles) {
    context.addWatchFile?.(file);
  }
  hmr.replaceCssModuleDependency(
    moduleFile,
    result.dependencyFiles ?? result.watchFiles,
    result.styleAssets,
  );
  const styleAsset = resolveCssModuleStyleAssetVirtualId(virtualId);
  if (styleAsset) {
    return {
      code: createCssModuleDevStyleSource(
        moduleFile,
        result,
        styleAsset.assetFile,
      ),
    };
  }
  if (isCssModuleRootStyleVirtualModuleId(virtualId)) {
    return {
      code: createCssModuleDevStyleSource(moduleFile, result),
    };
  }
  return {
    code: createCssModuleLocalsViteLoadCode(
      result,
      toCssModuleStyleVirtualId(moduleFile),
    ),
    moduleType: 'js' as const,
  };
};

const toResolvedVirtualId = (id: string) => {
  if (id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)) {
    return id;
  }
  if (id.startsWith(BROWSER_VIRTUAL_ID_PREFIX)) {
    return `${RESOLVED_VIRTUAL_ID_PREFIX}${id.slice(
      BROWSER_VIRTUAL_ID_PREFIX.length,
    )}`;
  }
  return null;
};

const createModuleStyleGraph = (
  options: AukletStylePluginOptions,
  viteRoot: string,
) => {
  const mode = options.mode ?? 'package';
  const root = options.root ?? resolveGraphRoot(mode, viteRoot);

  return new ModuleStyleGraph({
    ...options,
    mode,
    root,
  });
};

const resolveGraphRoot = (
  mode: NonNullable<ModuleStyleGraphOptions['mode']>,
  viteRoot: string,
) => {
  if (mode === 'monorepo') return findWorkspaceRoot(viteRoot) ?? process.cwd();
  return viteRoot;
};

const createWatcherErrorPayload = (error: unknown, file: string) => {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : String(error));

  return {
    type: 'error' as const,
    err: {
      message: err.message,
      stack: err.stack ?? err.message,
      plugin: 'auklet-css',
      id: file,
    },
  };
};

const invalidateVirtualModules = (
  server: Pick<ViteDevServer, 'environments'>,
  graph: ModuleStyleGraph,
) => {
  for (const packageName of graph.getPackageNames()) {
    for (const entry of ['style.css', 'external.css', 'module.css']) {
      invalidateModuleInEnvironments(
        server,
        `${RESOLVED_VIRTUAL_ID_PREFIX}${packageName}/${entry}`,
      );
    }
  }
};

export type AukletStylePluginOptions = Partial<
  Pick<ModuleStyleGraphOptions, 'root' | 'mode'>
> &
  Omit<ModuleStyleGraphOptions, 'root'>;

export function aukletStylePlugin(options: AukletStylePluginOptions = {}) {
  let graph: ModuleStyleGraph | null = null;
  let clientModuleGraph: DevEnvironment['moduleGraph'] | null = null;

  const getGraph = () => {
    if (!graph) {
      graph = createModuleStyleGraph(options, process.cwd());
    }
    return graph;
  };

  const hmr = new AukletStyleHmr(getGraph);

  return {
    name: 'auklet-css',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      graph = createModuleStyleGraph(options, config.root);
      // Mutate resolved config so the Less FileManager is definitely present.
      // Vite's less IdResolver does not call user resolveId; remap + HMR track
      // for `@import (reference) 'pkg/….less'` must run inside Less.
      const preprocessorOptions = (config.css.preprocessorOptions ??= {});
      const lessOptions = (preprocessorOptions.less ??= {});
      const plugins = ((lessOptions as { plugins?: Array<unknown> }).plugins ??=
        []);
      const alreadyInstalled = plugins.some(
        (plugin) =>
          plugin &&
          typeof plugin === 'object' &&
          (plugin as { __aukletViteLess?: boolean }).__aukletViteLess,
      );
      if (!alreadyInstalled) {
        const plugin = createAukletViteLessPlugin({
          trackImport: (resolvedFile, importer) => {
            hmr.trackViteLessImport(resolvedFile, importer);
          },
        }) as { __aukletViteLess?: boolean };
        plugin.__aukletViteLess = true;
        plugins.push(plugin);
      }
    },

    resolveId: {
      order: 'pre' as const,
      async handler(source: string, importer?: string) {
        const graph = getGraph();
        const cleanId = stripCssModuleQuery(source);

        // Foreign `\0` sources (e.g. MF `__loadShare__`) are never style entries.
        if (isForeignViteVirtualId(cleanId)) {
          return null;
        }

        // Reclaim owned virtuals before importer-based path work. MF remotes often
        // re-resolve `\0auklet-css-module:…` / `auklet-css:…` with a foreign
        // `__loadShare__` importer; that must not drop the claim.
        const styleAsset = resolveCssModuleStyleAssetVirtualId(cleanId);
        if (styleAsset) return styleAsset.id;

        if (cleanId.startsWith(RESOLVED_CSS_MODULE_PREFIX)) {
          return cleanId;
        }
        if (fromPackageStyleVirtualId(cleanId)) {
          return cleanId;
        }

        const resolvedVirtualId = toResolvedVirtualId(cleanId);
        if (resolvedVirtualId) return resolvedVirtualId;
        if (cleanId.startsWith(VIRTUAL_ID_PREFIX)) {
          return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId.slice(
            VIRTUAL_ID_PREFIX.length,
          )}`;
        }

        // Foreign importers are not filesystem anchors — skip package-root and
        // relative path resolution (owned virtual reclaim already ran above).
        const foreignImporter =
          importer != null && isForeignViteVirtualId(importer);
        const importerAnchor =
          importer && !foreignImporter
            ? resolveImporterAnchorFile(importer)
            : null;

        const importerPackageRoot = importerAnchor
          ? (graph.resolvePackageRootForFile(importerAnchor) ??
            findPackageRootForFile(importerAnchor))
          : null;

        // Workspace shared.output: resolve exports→dist/shim to producer source.
        // Installed packages keep published artifacts. Gate first — resolveId is hot.
        if (importerPackageRoot && isExternalPackageSpecifier(cleanId)) {
          if (isCssModuleSpecifier(cleanId)) {
            const sharedOutputSource = await resolveWorkspaceSharedOutputModule(
              {
                source: cleanId,
                importerPackageRoot,
              },
            );
            if (sharedOutputSource) {
              return {
                id: toCssModuleVirtualId(sharedOutputSource),
                moduleSideEffects: true,
              };
            }
          } else if (isPlainStyleSpecifier(cleanId)) {
            const sharedOutputPlain =
              await resolveWorkspaceSharedOutputPlainStyle({
                source: cleanId,
                importerPackageRoot,
              });
            if (sharedOutputPlain) {
              // JS import only. Less `@import` remap/track is viteLessPlugin
              // (Vite's Less IdResolver uses an internal resolver, not user
              // resolveId).
              return {
                id: toPackageStyleVirtualId(sharedOutputPlain),
                moduleSideEffects: true,
              };
            }
          }
        }

        const cssModuleFile = resolveCssModuleImport({
          source,
          // Prefer the unwrapped file anchor so package-style / css-module
          // virtual importers resolve relatives and package roots correctly.
          // Foreign `\0virtual:mf:…` importers stay unset.
          importer: importerAnchor ?? undefined,
          importerPackageRoot: importerPackageRoot ?? undefined,
          parseModuleFileFromId: fromCssModuleVirtualId,
        });
        if (cssModuleFile) {
          return {
            id: toCssModuleVirtualId(cssModuleFile),
            moduleSideEffects: true,
          };
        }

        if (importerPackageRoot) {
          try {
            const packageStyleFile = resolvePlainPackageStyleFile(
              cleanId,
              importerPackageRoot,
            );
            if (packageStyleFile) {
              return {
                id: toPackageStyleVirtualId(packageStyleFile),
                moduleSideEffects: true,
              };
            }
          } catch {
            // Fall through for package virtual CSS entries and Vite-native CSS.
          }
        }

        if (!graph.parsePackageStyleId(cleanId)) return null;
        return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId}`;
      },
    },

    async load(this: { addWatchFile?: (file: string) => void }, id: string) {
      const environmentName =
        (this as { environment?: { name?: string } }).environment?.name ??
        'client';
      const styleAsset = resolveCssModuleStyleAssetVirtualId(id);
      const cssModuleFile =
        styleAsset?.moduleFile ??
        fromCssModuleVirtualId(id) ??
        (() => {
          const cleanId = stripCssModuleQuery(id);
          if (!isCssModuleFile(cleanId) || !fs.existsSync(cleanId)) return null;
          return cleanId;
        })();

      if (cssModuleFile) {
        return loadCssModuleCode(
          this,
          id,
          cssModuleFile,
          hmr,
          getGraph(),
          environmentName,
        );
      }

      const packageStyleFile = fromPackageStyleVirtualId(id);
      if (packageStyleFile) {
        this.addWatchFile?.(packageStyleFile);
        return {
          code: await loadPackageStyleCss(packageStyleFile),
          moduleType: 'css' as const,
        };
      }

      if (!id.startsWith(RESOLVED_VIRTUAL_ID_PREFIX)) return null;

      const originalId = id.slice(RESOLVED_VIRTUAL_ID_PREFIX.length);
      const graph = getGraph();
      const parsed = graph.parsePackageStyleId(originalId);
      if (!parsed) return null;

      const result = await graph.createPackageStyleCode(parsed);
      if (clientModuleGraph) {
        hmr.pruneStaleVirtualDependencies(clientModuleGraph);
      }
      hmr.replaceVirtualStyleDependency(
        id,
        result.watchFiles,
        result.watchFileKinds,
      );

      for (const file of result.watchFiles) {
        this.addWatchFile?.(file);
      }
      return result.code;
    },

    async configureServer(server: ViteDevServer) {
      const graph = getGraph();
      clientModuleGraph = server.environments.client.moduleGraph;
      hmr.installFullReloadGuard(server);

      const close = server.close.bind(server);
      server.close = (async () => {
        hmr.cancelStaleVirtualDependencyPrune();
        return close();
      }) as ViteDevServer['close'];

      // Warm before first Less (reference) compile — sync remap needs this cache.
      await graph.warmSharedOutputRemapCaches();

      server.watcher.add(await graph.getWatchRoots());

      const isPackageGraphFile = (file: string) =>
        graph.isSourceGraphFile(file) || graph.isPackageManifestFile(file);

      const invalidatePackageStyleGraph = (file: string) => {
        if (isPackageGraphFile(file)) {
          graph.invalidateFile(file);
          invalidateVirtualModules(server, graph);
          return true;
        }
        if (!graph.invalidateDependencyFile(file)) return false;
        invalidateVirtualModules(server, graph);
        return true;
      };

      const environmentModuleGraph = {
        getModuleById(id: string) {
          for (const environment of Object.values(server.environments)) {
            const mod = environment.moduleGraph.getModuleById(id);
            if (mod) return mod;
          }
          return undefined;
        },
      };

      const reloadCssModuleGraph = (file: string, event: 'add' | 'unlink') => {
        const isModuleFile = isCssModuleFile(file);
        const trackedPartial = hmr.hasTrackedCssModuleDependency(
          file,
          environmentModuleGraph,
        );
        const trackedPackageStyle = hmr.hasTrackedStyleDependency(
          file,
          environmentModuleGraph,
        );
        const packageRelated = isPackageGraphFile(file) || trackedPackageStyle;

        if (!isModuleFile && !trackedPartial && !packageRelated) {
          return false;
        }

        if (packageRelated || trackedPackageStyle) {
          invalidatePackageStyleGraph(file);
        }

        if (event === 'unlink' && (isModuleFile || trackedPartial)) {
          hmr.removeCssModuleGraphFile(
            server,
            file,
            isModuleFile ? file : null,
          );
        }

        return true;
      };

      const reloadStyleGraph = (
        file: string,
        event: 'add' | 'unlink' | 'change' = 'change',
      ) => {
        if (event !== 'change') {
          if (reloadCssModuleGraph(file, event)) {
            server.ws.send({ type: 'full-reload' });
            return;
          }
        }

        if (!invalidatePackageStyleGraph(file)) return;
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', (file) => reloadStyleGraph(file, 'add'));
      server.watcher.on('unlink', (file) => reloadStyleGraph(file, 'unlink'));
      server.watcher.on('change', async (file) => {
        try {
          hmr.scheduleStaleVirtualDependencyPrune(
            server.environments.client.moduleGraph,
          );

          if (graph.isStyleConfigFile(file)) {
            invalidateWorkspaceSharedOutputResolveCache(
              graph.resolvePackageRootForFile(file) ??
                findPackageRootForFile(file) ??
                undefined,
            );
            // Full-graph warm is correct (deps may mirror the changed config).
            // Optimization later: warm only the invalidated packageRoot (+ deps).
            await graph.warmSharedOutputRemapCaches();
            reloadStyleGraph(file);
          } else if (graph.isSourceModuleFile(file)) {
            await hmr.handleSourceModuleChange(server, file);
          }
        } catch (error) {
          logger.error('package css change watcher failed');
          logger.error(error);
          server.ws.send(createWatcherErrorPayload(error, file));
        }
      });
    },

    hotUpdate: {
      order: 'pre',
      handler(
        this: { environment: DevEnvironment },
        context: HotUpdateOptions,
      ) {
        return hmr.handleCombinedHotUpdate(
          context,
          this.environment.moduleGraph,
          this.environment.name,
        );
      },
    },
  } satisfies Plugin;
}
