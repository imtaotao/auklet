import path from 'node:path';
import { isString } from 'aidly';
import type {
  HotPayload,
  HotUpdateOptions,
  ModuleNode,
  ViteDevServer,
} from 'vite';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { normalizeFileKey } from '#auklet/utils';
import { createScopedAukletLogger } from '#auklet/logger';

// package CSS 的 HMR 不能直接走 Vite 原生 CSS 文件链路：
// 1. 浏览器 import 的是 auklet-css:* 虚拟 CSS 模块，不是真实的
//   packages/*/src/**/*.css 文件，所以真实 CSS 变化时 Vite 的 modules 可能为空。
// 2. Vite dev 会把 CSS 转成自接受的 JS 模块，重新执行模块里的 updateStyle()
//   才能更新样式，因此这里手动发送 js-update，而不是 css-update。
// 3. @tailwindcss/vite 会在相关 CSS 变化时主动发 full-reload。package CSS 已由
//   这个插件接管 HMR 时，需要在一个很短的窗口内吞掉这次 reload。

const FULL_RELOAD_SUPPRESS_MS = 100;
const DUPLICATE_UPDATE_IGNORE_MS = 500;
const logger = createScopedAukletLogger('css:vite');

const toBrowserVirtualPath = (id: string) => {
  return `/@id/${id.replace('\0', '__x00__')}`;
};

const getRelativeFile = (file: string) => {
  return path.relative(process.cwd(), file);
};

const invalidateVirtualModules = (
  server: Pick<ViteDevServer, 'moduleGraph'>,
  graph: ModuleStyleGraph,
) => {
  const modules: Array<ModuleNode> = [];
  for (const packageName of graph.getPackageNames()) {
    for (const entry of ['style.css', 'external.css', 'module.css']) {
      const module = server.moduleGraph.getModuleById(
        `\0auklet-css:${packageName}/${entry}`,
      );
      if (!module) continue;
      server.moduleGraph.invalidateModule(module);
      modules.push(module);
    }
  }
  return modules;
};

const addVirtualStyleDependency = (
  virtualIdsByDependency: VirtualIdsByDependency,
  file: string,
  virtualId: string,
) => {
  const normalizedFile = normalizeFileKey(file);
  const values =
    virtualIdsByDependency.get(normalizedFile) ?? new Set<string>();
  values.add(virtualId);
  virtualIdsByDependency.set(normalizedFile, values);
};

const getDependencyVirtualIds = (
  virtualIdsByDependency: VirtualIdsByDependency,
  file: string,
) => {
  return Array.from(virtualIdsByDependency.get(normalizeFileKey(file)) ?? []);
};

const getDependencyVirtualModules = (
  virtualIdsByDependency: VirtualIdsByDependency,
  server: Pick<ViteDevServer, 'moduleGraph'>,
  file: string,
) => {
  return getDependencyVirtualIds(virtualIdsByDependency, file).flatMap((id) => {
    const module = server.moduleGraph.getModuleById(id);
    return module ? [module] : [];
  });
};

type VirtualIdsByDependency = Map<string, Set<string>>;

export class AukletStyleHmr {
  private readonly lastUpdateTimes = new Map<string, number>();
  private suppressFullReloadUntil = 0;
  private readonly virtualIdsByDependency: VirtualIdsByDependency = new Map();

  constructor(private readonly graph: () => ModuleStyleGraph) {}

  trackVirtualStyleDependency(file: string, virtualId: string) {
    addVirtualStyleDependency(this.virtualIdsByDependency, file, virtualId);
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

  handleStyleHotUpdate(context: HotUpdateOptions) {
    const graph = this.graph();
    if (
      !graph.isSourceGraphFile(context.file) ||
      !graph.isStyleFile(context.file)
    ) {
      return;
    }
    if (this.isDuplicateUpdate(context.file)) {
      return [];
    }

    this.suppressFullReload();

    const virtualIds = getDependencyVirtualIds(
      this.virtualIdsByDependency,
      context.file,
    );
    const modules = getDependencyVirtualModules(
      this.virtualIdsByDependency,
      context.server,
      context.file,
    );

    for (const module of modules) {
      context.server.moduleGraph.invalidateModule(module);
    }
    invalidateVirtualModules(context.server, graph);

    const updates = virtualIds.map((id) => {
      const browserPath = toBrowserVirtualPath(id);
      return {
        type: 'js-update' as const,
        path: browserPath,
        acceptedPath: browserPath,
        timestamp: context.timestamp,
        explicitImportRequired: false,
        isWithinCircularImport: false,
      };
    });
    logger.info(
      `package css hmr ${getRelativeFile(context.file)} tracked=${virtualIds.length} updates=${updates.length}`,
    );

    if (updates.length) {
      context.server.ws.send({
        type: 'update',
        updates,
      });
    }
    return [];
  }

  private suppressFullReload() {
    this.suppressFullReloadUntil = Date.now() + FULL_RELOAD_SUPPRESS_MS;
  }

  private shouldSuppressFullReload() {
    return Date.now() <= this.suppressFullReloadUntil;
  }

  private isDuplicateUpdate(file: string) {
    const now = Date.now();
    const normalizedFile = normalizeFileKey(file);
    const lastUpdateTime = this.lastUpdateTimes.get(normalizedFile) ?? 0;
    const isDuplicate = now - lastUpdateTime < DUPLICATE_UPDATE_IGNORE_MS;

    this.lastUpdateTimes.set(normalizedFile, now);

    return isDuplicate;
  }
}
