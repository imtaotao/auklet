import { isString, throttle } from 'aidly';
import type {
  DevEnvironment,
  HotPayload,
  HotUpdateOptions,
  ViteDevServer,
} from 'vite';
import type { CssModuleStyleAsset } from '#auklet/css/modules/compileCssModule';
import { VirtualDependencyTracker } from '#auklet/css/vite/hmr/tracker';
import { CssModuleDevCompileCacheRegistry } from '#auklet/css/vite/hmr/cssModuleCompileCache';
import {
  collectCssModuleHotUpdateModules,
  planCssModuleHotUpdate,
} from '#auklet/css/vite/hmr/cssModule';
import {
  toResolvedCssModuleStyleAssetVirtualId,
  toCssModuleVirtualIds,
} from '#auklet/css/vite/cssModuleVirtualId';
import {
  collectPackageStyleHotUpdateModules,
  handlePackageSourceModuleChange,
  planPackageStyleHotUpdate,
  replacePackageStyleDependency,
} from '#auklet/css/vite/hmr/packageStyle';
import {
  dedupeModuleNodes,
  invalidateModuleInEnvironments,
  type ModuleGraphLookup,
} from '#auklet/css/vite/hmr/propagate';
import {
  type AukletStyleHmrOptions,
  type TrackedVirtualStyleFileKind,
} from '#auklet/css/vite/hmr/shared';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import {
  collectViteLessImporterHotUpdateModules,
  filterSafeViteNativeHotUpdateModules,
  LessImportTracker,
} from '#auklet/css/vite/hmr/viteLessImport';
import { collectDirectPackageStyleHotUpdateModules } from '#auklet/css/vite/packageStyleVirtualId';
import { createAukletLogger } from '#auklet/logger';
import { normalizeFileKey } from '#auklet/utils';

const FULL_RELOAD_SUPPRESS_MS = 100;

// auklet dev HMR 分三条链路，hotUpdate 在 handleCombinedHotUpdate 合并：
//
// 1. package CSS（全局样式图）—— packageStyle.ts + packageStyleVirtualId.ts
//    - 浏览器 import 的是 auklet-css:* 或 \0auklet-package-style: 虚拟 CSS，
//      不是 packages/*/src/**/*.css 源文件；真实 CSS 变化时 Vite 的 modules
//      可能为空。
//    - 虚拟 CSS 在 dev 里会被 Vite 转成自接受的 JS，更新样式需要重新执行
//      updateStyle()；通过 hotUpdate 返回 ModuleNode，让 Vite propagateUpdate
//      发送 self-accept js-update。
//    - @tailwindcss/vite 会在相关 CSS 变化时主动发 full-reload；package CSS 由
//      这个插件接管 HMR 时，需要在一个很短的窗口内吞掉这次 reload。
//
// 2. CSS Modules（*.module.css / *.module.less）—— cssModule.ts
//    - 浏览器 import 的是 \0auklet-css-module:*.js locals shim，side-effect
//      import \0auklet-css-module:*.style.css 交给 Vite CSS pipeline。
//    - style/partial 虚拟 CSS 保留 @import 引用并由 Vite self-accept；
//      style-only 变更只 invalidate CSS 边界。
//    - locals 仅在 class map 变化时进入 hotUpdate modules；不伪造
//      importer.acceptedHmrDeps，沿 importer 链寻找真实 HMR boundary。
//
// 3. Vite-native Less @import（非 auklet 虚拟模块）—— viteLessImport.ts /
//    viteLessPlugin.ts
//    - Resolve：FileManager → tryResolveExternalLessFile /
//      resolveExternalLessImport（与 production external Less 同一套：exports
//      → published，workspace shared.output warm cache 时 remap 到 source）。
//    - HMR：只 track 具体入口 `.less`（Less options.filename）；track 空时
//      source-scan；再合并 filter 后的 Vite context.modules（safeNative，
//      去掉正在改的 partial，避免 dead-end full-reload）。
//
// Virtual CSS ids: VirtualDependencyTracker.
// Less entry importers: LessImportTracker（绝对 .less path）。

const logger = createAukletLogger({ scope: 'css:vite' });

export class AukletStyleHmr {
  private suppressFullReloadUntil = 0;
  private readonly packageStyleTracker = new VirtualDependencyTracker();
  private readonly cssModuleTracker = new VirtualDependencyTracker();
  private readonly viteLessImportTracker = new LessImportTracker();
  private readonly cssModuleAssetDependencies = new Map<
    string,
    Map<string, Array<string>>
  >();
  private readonly cssModuleCompileCaches =
    new CssModuleDevCompileCacheRegistry();
  private readonly schedulePruneStaleVirtualDependencies;
  private readonly pruneDelayMs: number;

  constructor(
    private readonly graph: () => ModuleStyleGraph,
    options: AukletStyleHmrOptions = {},
  ) {
    this.pruneDelayMs = options.pruneDelayMs ?? 2 * 60 * 1000;
    this.schedulePruneStaleVirtualDependencies = throttle(
      this.pruneDelayMs,
      (moduleGraph: ModuleGraphLookup) =>
        this.pruneStaleVirtualDependencies(moduleGraph),
    );
  }

  trackVirtualStyleDependency(
    file: string,
    virtualId: string,
    kind: TrackedVirtualStyleFileKind = 'dependency',
  ) {
    this.packageStyleTracker.track(file, virtualId, kind);
  }

  trackViteLessImport(resolvedFile: string, importer: string) {
    this.viteLessImportTracker.track(resolvedFile, importer);
  }

  replaceCssModuleDependency(
    moduleFile: string,
    files: Array<string>,
    styleAssets: Array<Pick<CssModuleStyleAsset, 'file' | 'dependencies'>> = [],
  ) {
    for (const virtualId of toCssModuleVirtualIds(moduleFile)) {
      this.cssModuleTracker.replaceDependencies(virtualId, files);
    }
    const moduleKey = normalizeFileKey(moduleFile);
    const nextAssetDependencies = new Map(
      styleAssets.map((asset) => [
        toResolvedCssModuleStyleAssetVirtualId(moduleFile, asset.file),
        asset.dependencies,
      ]),
    );
    const previousAssetDependencies =
      this.cssModuleAssetDependencies.get(moduleKey) ?? new Map();
    for (const [virtualId, dependencies] of previousAssetDependencies) {
      if (nextAssetDependencies.has(virtualId)) continue;
      for (const dependency of dependencies) {
        this.cssModuleTracker.unlink(dependency, virtualId);
      }
    }
    for (const asset of styleAssets) {
      this.cssModuleTracker.replaceDependencies(
        toResolvedCssModuleStyleAssetVirtualId(moduleFile, asset.file),
        asset.dependencies,
      );
    }
    this.cssModuleAssetDependencies.set(moduleKey, nextAssetDependencies);
  }

  compileCssModuleForDev(
    moduleFile: string,
    sourceRoot?: string,
    environment = 'client',
    packageRoot?: string,
  ) {
    return this.cssModuleCompileCaches
      .forEnvironment(environment)
      .compile(moduleFile, { packageRoot, sourceRoot });
  }

  hasTrackedCssModuleDependency(file: string, moduleGraph?: ModuleGraphLookup) {
    return this.cssModuleTracker.hasTracked(file, moduleGraph);
  }

  hasLiveCssModuleTracking(moduleGraph?: ModuleGraphLookup) {
    return this.cssModuleTracker.hasAnyLiveVirtualIds(moduleGraph);
  }

  removeCssModuleGraphFile(
    server: Pick<ViteDevServer, 'environments'>,
    file: string,
    moduleFile?: string | null,
  ) {
    const virtualIds = new Set(this.cssModuleTracker.listVirtualIds(file));
    if (moduleFile) {
      for (const virtualId of toCssModuleVirtualIds(moduleFile)) {
        virtualIds.add(virtualId);
      }
      const moduleKey = normalizeFileKey(moduleFile);
      const assetDependencies =
        this.cssModuleAssetDependencies.get(moduleKey) ?? new Map();
      for (const virtualId of assetDependencies.keys()) {
        virtualIds.add(virtualId);
      }
      for (const virtualId of virtualIds) {
        this.cssModuleTracker.removeVirtualId(virtualId);
      }
      this.cssModuleAssetDependencies.delete(moduleKey);
    }

    this.cssModuleTracker.removeDependencyFile(file);
    this.packageStyleTracker.removeDependencyFile(file);
    this.cssModuleCompileCaches.invalidateWatchFile(file);
    if (moduleFile) {
      this.cssModuleCompileCaches.invalidateModuleFile(moduleFile);
    }

    for (const virtualId of virtualIds) {
      invalidateModuleInEnvironments(server, virtualId);
    }
  }

  async handleCombinedHotUpdate(
    context: HotUpdateOptions,
    moduleGraph: ModuleGraphLookup,
    environment = 'client',
  ) {
    const cssVirtualIds = await planCssModuleHotUpdate({
      tracker: this.cssModuleTracker,
      file: context.file,
      moduleGraph,
      read: context.read,
      compileCache: this.cssModuleCompileCaches.forEnvironment(environment),
      resolveSourceRoot: (moduleFile) =>
        this.graph().resolveSourceRootForFile(moduleFile),
      resolvePackageRoot: (moduleFile) => {
        const graph = this.graph();
        return typeof graph.resolvePackageRootForFile === 'function'
          ? graph.resolvePackageRootForFile(moduleFile)
          : null;
      },
    });
    const packagePlan = planPackageStyleHotUpdate({
      graph: this.graph(),
      tracker: this.packageStyleTracker,
      file: context.file,
      moduleGraph,
    });
    const directPackageStyleModules = collectDirectPackageStyleHotUpdateModules(
      {
        file: context.file,
        moduleGraph,
      },
    );
    const viteLessImporterModules = collectViteLessImporterHotUpdateModules({
      tracker: this.viteLessImportTracker,
      file: context.file,
      moduleGraph,
    });
    const safeNativeModules = filterSafeViteNativeHotUpdateModules({
      file: context.file,
      modules: context.modules ?? [],
    });

    const cssPlan = collectCssModuleHotUpdateModules({
      moduleGraph,
      virtualIds: cssVirtualIds,
    });
    const packageModules = packagePlan
      ? await collectPackageStyleHotUpdateModules({
          graph: this.graph(),
          file: context.file,
          moduleGraph,
          plan: packagePlan,
        })
      : [];

    // Vite-native Less @import deps have no graph edge (addWatchFile only).
    // Importers come from LessImportTracker / source-scan; never return the
    // changed partial itself (dead-end → full-reload, then suppressed). Exit
    // only after merge — safeNativeModules can be the sole update path.
    const modules = dedupeModuleNodes([
      ...cssPlan,
      ...packageModules,
      ...directPackageStyleModules,
      ...viteLessImporterModules,
      ...safeNativeModules,
    ]);
    if (!modules.length) {
      return undefined;
    }

    this.suppressFullReload();
    const packageCount =
      packageModules.length + directPackageStyleModules.length;
    const c = logger.colors;
    const count = (label: string, value: number) =>
      `${c.dim(`${label}=`)}${
        value > 0 ? c.green(String(value)) : c.dim(String(value))
      }`;
    logger.info(
      [
        c.cyan('style hmr'),
        c.yellow(context.file),
        count('cssModules', cssPlan.length),
        count('package', packageCount),
        count('lessImporters', viteLessImporterModules.length),
        count('modules', modules.length),
      ].join(' '),
    );
    return modules;
  }

  replaceVirtualStyleDependency(
    virtualId: string,
    files: Array<string>,
    fileKinds: Array<{
      file: string;
      kind: TrackedVirtualStyleFileKind;
    }> = [],
  ) {
    replacePackageStyleDependency(
      this.packageStyleTracker,
      virtualId,
      files,
      fileKinds,
    );
  }

  hasTrackedStyleDependency(file: string, moduleGraph?: ModuleGraphLookup) {
    return this.packageStyleTracker.hasTracked(file, moduleGraph);
  }

  pruneStaleVirtualDependencies(moduleGraph: ModuleGraphLookup) {
    this.packageStyleTracker.pruneStale(moduleGraph);
    this.cssModuleTracker.pruneStale(moduleGraph);
    this.viteLessImportTracker.pruneStale(moduleGraph);
  }

  scheduleStaleVirtualDependencyPrune(moduleGraph: ModuleGraphLookup) {
    this.schedulePruneStaleVirtualDependencies(moduleGraph);
  }

  cancelStaleVirtualDependencyPrune() {
    this.schedulePruneStaleVirtualDependencies.cancel();
  }

  installFullReloadGuard(server: Pick<ViteDevServer, 'ws'>) {
    const send = server.ws.send.bind(server.ws) as ViteDevServer['ws']['send'];
    server.ws.send = ((payload: HotPayload, data?: unknown) => {
      if (
        !isString(payload) &&
        payload.type === 'full-reload' &&
        this.shouldSuppressFullReload()
      ) {
        logger.info('suppressed package css full-reload');
        return;
      }
      if (isString(payload)) {
        send(payload, data as never);
        return;
      }
      send(payload);
    }) as ViteDevServer['ws']['send'];
  }

  handleSourceModuleChange(
    server: Pick<ViteDevServer, 'environments'>,
    file: string,
  ) {
    return handlePackageSourceModuleChange({
      graph: this.graph(),
      tracker: this.packageStyleTracker,
      server,
      file,
      suppressFullReload: () => this.suppressFullReload(),
    });
  }

  private suppressFullReload() {
    this.suppressFullReloadUntil = Date.now() + FULL_RELOAD_SUPPRESS_MS;
  }

  private shouldSuppressFullReload() {
    return Date.now() <= this.suppressFullReloadUntil;
  }
}

export type { AukletStyleHmrOptions } from '#auklet/css/vite/hmr/shared';

export type StyleHotUpdateEnvironment = Pick<DevEnvironment, 'moduleGraph'>;
