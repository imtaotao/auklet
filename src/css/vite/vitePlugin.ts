import fs from 'node:fs';
import path from 'node:path';
import type {
  DevEnvironment,
  HotUpdateOptions,
  Plugin,
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
import { isCssModuleSpecifier } from '#auklet/css/core/resolvers/externalPackageStyle';
import { createCssModuleLocalsViteLoadCode } from '#auklet/css/modules/compileCssModule';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  resolveCssModuleImport,
  stripCssModuleQuery,
} from '#auklet/css/modules/resolveCssModuleImport';
import {
  invalidateWorkspaceSharedOutputResolveCache,
  resolveWorkspaceSharedOutputModule,
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
import { createAukletLogger } from '#auklet/logger';
import { findWorkspaceRoot } from '#auklet/workspace/root';

const VIRTUAL_ID_PREFIX = 'virtual:auklet-css:';
const RESOLVED_VIRTUAL_ID_PREFIX = '\0auklet-css:';
const RESOLVED_CSS_MODULE_PREFIX = '\0auklet-css-module:';
const PACKAGE_STYLE_VIRTUAL_PREFIX = '\0auklet-package-style:';
const BROWSER_VIRTUAL_ID_PREFIX = 'auklet-css:';
const logger = createAukletLogger({ scope: 'css:vite' });

const toPackageStyleVirtualId = (file: string) =>
  `${PACKAGE_STYLE_VIRTUAL_PREFIX}${path.resolve(file)}`;

const fromPackageStyleVirtualId = (id: string) => {
  if (!id.startsWith(PACKAGE_STYLE_VIRTUAL_PREFIX)) return null;
  return path.resolve(id.slice(PACKAGE_STYLE_VIRTUAL_PREFIX.length));
};

const fromCssModuleVirtualId = cssModuleFileFromVirtualId;

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

    configResolved(config: { root: string }) {
      graph = createModuleStyleGraph(options, config.root);
    },

    resolveId: {
      order: 'pre' as const,
      async handler(source: string, importer?: string) {
        const graph = getGraph();
        const cleanId = stripCssModuleQuery(source);

        const styleAsset = resolveCssModuleStyleAssetVirtualId(cleanId);
        if (styleAsset) return styleAsset.id;

        if (cleanId.startsWith(RESOLVED_CSS_MODULE_PREFIX)) {
          return cleanId;
        }

        const importerPackageRoot = importer
          ? (graph.resolvePackageRootForFile(importer) ??
            findPackageRootForFile(importer))
          : null;

        // Workspace shared.output: resolve exports→shim to producer source so
        // existing CSS Modules HMR applies. Installed packages keep the shim.
        // Gate first — resolveId is hot; skip non package Modules imports.
        if (
          importerPackageRoot &&
          isExternalPackageSpecifier(cleanId) &&
          isCssModuleSpecifier(cleanId)
        ) {
          const sharedOutputSource = await resolveWorkspaceSharedOutputModule({
            source: cleanId,
            importerPackageRoot,
          });
          if (sharedOutputSource) {
            return {
              id: toCssModuleVirtualId(sharedOutputSource),
              moduleSideEffects: true,
            };
          }
        }

        const cssModuleFile = resolveCssModuleImport({
          source,
          importer,
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

        const resolvedVirtualId = toResolvedVirtualId(cleanId);
        if (resolvedVirtualId) return resolvedVirtualId;
        if (cleanId.startsWith(VIRTUAL_ID_PREFIX)) {
          return `${RESOLVED_VIRTUAL_ID_PREFIX}${cleanId.slice(
            VIRTUAL_ID_PREFIX.length,
          )}`;
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
            const module = environment.moduleGraph.getModuleById(id);
            if (module) return module;
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
