import path from 'node:path';
import { isString } from 'aidly';
import type { HotPayload, HotUpdateOptions, ViteDevServer } from 'vite';
import type { ModuleStyleGraph } from '#auklet/css/vite/moduleGraph/graph';
import { normalizeFileKey } from '#auklet/utils';
import { createAukletLogger } from '#auklet/logger';

// package CSS 的 HMR 不能直接走 Vite 原生 CSS 文件链路：
// 1. 浏览器 import 的是 auklet-css:* 虚拟 CSS 模块，不是真实的
//   packages/*/src/**/*.css 文件，所以真实 CSS 变化时 Vite 的 modules 可能为空。
// 2. Vite dev 会把 CSS 转成自接受的 JS 模块，重新执行模块里的 updateStyle()
//   才能更新样式，因此这里手动发送 js-update，而不是 css-update。
// 3. @tailwindcss/vite 会在相关 CSS 变化时主动发 full-reload。package CSS 已由
//   这个插件接管 HMR 时，需要在一个很短的窗口内吞掉这次 reload。

type VirtualIdsByDependency = Map<string, Set<string>>;

const FULL_RELOAD_SUPPRESS_MS = 100;
const DUPLICATE_UPDATE_IGNORE_MS = 500;
const logger = createAukletLogger({ scope: 'css:vite' });

const toBrowserVirtualPath = (id: string) => {
  return `/@id/${id.replace('\0', '__x00__')}`;
};

const getRelativeFile = (file: string) => {
  return path.relative(process.cwd(), file);
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

const createJsUpdates = (virtualIds: Array<string>, timestamp: number) => {
  return virtualIds.map((id) => {
    const browserPath = toBrowserVirtualPath(id);
    return {
      type: 'js-update' as const,
      path: browserPath,
      acceptedPath: browserPath,
      timestamp,
      explicitImportRequired: false,
      isWithinCircularImport: false,
    };
  });
};

export class AukletStyleHmr {
  private readonly lastUpdateTimes = new Map<string, number>();
  private suppressFullReloadUntil = 0;
  private readonly virtualIdsByDependency: VirtualIdsByDependency = new Map();

  constructor(private readonly graph: () => ModuleStyleGraph) {}

  trackVirtualStyleDependency(file: string, virtualId: string) {
    addVirtualStyleDependency(this.virtualIdsByDependency, file, virtualId);
  }

  hasTrackedStyleDependency(file: string) {
    return (
      getDependencyVirtualIds(this.virtualIdsByDependency, file).length > 0
    );
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
    this.suppressFullReload();
    graph.invalidateFile(context.file);
    if (this.isDuplicateUpdate(context.file)) {
      return [];
    }

    const updates = this.sendVirtualStyleUpdates(
      context.file,
      context.server,
      context.timestamp,
    );
    logger.info(
      `package css hmr ${getRelativeFile(context.file)} tracked=${updates.tracked} updates=${updates.sent}`,
    );
    return [];
  }

  handleSourceModuleChange(
    server: Pick<ViteDevServer, 'moduleGraph' | 'ws'>,
    file: string,
  ) {
    const graph = this.graph();
    if (!graph.isSourceGraphFile(file) || !graph.isSourceModuleFile(file)) {
      return false;
    }

    graph.invalidateFile(file);
    const updates = this.sendVirtualStyleUpdates(file, server, Date.now());
    logger.info(
      `package css source hmr ${getRelativeFile(file)} tracked=${updates.tracked} updates=${updates.sent}`,
    );
    return true;
  }

  private sendVirtualStyleUpdates(
    file: string,
    server: Pick<ViteDevServer, 'moduleGraph' | 'ws'>,
    timestamp: number,
  ) {
    const virtualIds = getDependencyVirtualIds(
      this.virtualIdsByDependency,
      file,
    );
    const modules = getDependencyVirtualModules(
      this.virtualIdsByDependency,
      server,
      file,
    );

    for (const module of modules) {
      server.moduleGraph.invalidateModule(module);
    }

    const updates = createJsUpdates(virtualIds, timestamp);
    if (updates.length) {
      server.ws.send({
        type: 'update',
        updates,
      });
    }
    return {
      sent: updates.length,
      tracked: virtualIds.length,
    };
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
