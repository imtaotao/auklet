import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { isString } from 'aidly';
import {
  aukletConfigFiles,
  aukletDefaultOptions,
  isAukletConfigFile,
} from '#auklet/config';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import { createAukletLogger, type AukletLogger } from '#auklet/logger';
import type {
  ModuleStyleBuildConfig,
  ModuleStyleBuildContext,
} from '#auklet/types';

type ModuleStyleWatcherLogger = Pick<AukletLogger, 'error'>;

const errorLogInterval = 2_000;

export class ModuleStyleWatcher {
  private readonly context: ModuleStyleBuildContext & { packageRoot: string };
  private readonly config: ModuleStyleBuildConfig;
  private readonly logger: ModuleStyleWatcherLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private isBuilding = false;
  private shouldRebuild = false;
  private watcher: FSWatcher | null = null;
  private readonly lastErrorLogTimes = new Map<string, number>();

  constructor(
    context: ModuleStyleBuildContext = {},
    config: ModuleStyleBuildConfig = moduleStyleBuildConfig,
    logger: ModuleStyleWatcherLogger | null = null,
  ) {
    this.context = {
      packageRoot: process.cwd(),
      ...context,
    };
    this.config = config;
    this.logger = logger ?? createAukletLogger({ scope: 'css' });
  }

  async watch() {
    if (this.closed) return;
    await this.rebuild();
  }

  private async rebuild() {
    if (this.closed) return;
    if (this.isBuilding) {
      this.shouldRebuild = true;
      return;
    }
    this.isBuilding = true;
    try {
      try {
        const builder = new ModuleStyleBuilder(this.context, this.config);
        await builder.build();
      } catch (error) {
        this.logError('build', 'CSS build failed; waiting for changes.', error);
      }

      if (!this.closed) {
        try {
          await this.refreshWatcher();
        } catch (error) {
          this.logError(
            'watch-refresh',
            'CSS watcher failed; waiting for changes.',
            error,
          );
        }
      }
    } finally {
      this.isBuilding = false;
      if (this.shouldRebuild && !this.closed) {
        this.shouldRebuild = false;
        this.scheduleBuild();
      }
    }
  }

  private async refreshWatcher() {
    if (this.closed) return;

    const aukletConfig = this.context.aukletConfig ?? {};
    const sourceDir =
      this.context.source ?? aukletConfig.source ?? aukletDefaultOptions.source;
    const sourceRoot = path.join(this.context.packageRoot, sourceDir);
    const configPaths = aukletConfigFiles.map((file) =>
      path.join(this.context.packageRoot, file),
    );
    const watchPaths = [sourceRoot, ...configPaths].filter((file) =>
      fs.existsSync(file),
    );

    const previousWatcher = this.watcher;
    this.watcher = null;
    await previousWatcher?.close();
    if (this.closed) return;

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      interval: 300,
      usePolling: true,
    });
    this.watcher.on('all', (_event, file) => {
      if (this.closed) return;
      if (isString(file) && !this.shouldRebuildForFile(file)) {
        return;
      }
      this.scheduleBuild();
    });
    this.watcher.on('error', (error) => {
      if (this.closed) return;
      this.logError(
        'watch-event',
        'CSS watcher error; waiting for changes.',
        error,
      );
      this.scheduleBuild();
    });
  }

  private logError(kind: string, message: string, error: unknown) {
    const now = Date.now();
    const lastLogTime = this.lastErrorLogTimes.get(kind) ?? 0;
    if (now - lastLogTime < errorLogInterval) return;

    this.lastErrorLogTimes.set(kind, now);
    this.logger.error(message);
    this.logger.error(error);
  }

  private scheduleBuild() {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, 80);
  }

  private shouldRebuildForFile(file: string) {
    if (isAukletConfigFile(path.basename(file))) return true;
    if (SOURCE_MODULE_RE.test(file)) return true;
    return this.config.styleExtensions.includes(path.extname(file));
  }

  async close() {
    this.closed = true;
    this.shouldRebuild = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }
}
