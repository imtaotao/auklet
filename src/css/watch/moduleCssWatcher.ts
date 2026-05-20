import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { aukletConfigFile, aukletDefaultCssOptions } from '#auklet/config';
import { moduleCssBuildConfig } from '#auklet/css/core/config';
import { ModuleCssBuilder } from '#auklet/css/production/moduleCssBuilder';
import type {
  AukletLogger,
  ModuleCssBuildConfig,
  ModuleCssBuildContext,
} from '#auklet/types';

export class ModuleCssWatcher {
  private readonly context: ModuleCssBuildContext & { packageRoot: string };
  private readonly logger?: AukletLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isBuilding = false;
  private shouldRebuild = false;
  private watcher: FSWatcher | null = null;

  constructor(
    context: ModuleCssBuildContext = {},
    private readonly config: ModuleCssBuildConfig = moduleCssBuildConfig,
  ) {
    this.context = {
      packageRoot: process.cwd(),
      ...context,
    };
    this.logger = context.logger;
  }

  async watch() {
    await this.rebuild();
    this.logger?.log?.('[auklet:css] watch mode ready');
  }

  private async rebuild() {
    if (this.isBuilding) {
      this.shouldRebuild = true;
      return;
    }
    this.isBuilding = true;
    try {
      const builder = new ModuleCssBuilder(this.context, this.config);
      await builder.build();
      await this.refreshWatcher();
    } catch (error) {
      this.logger?.error?.(error);
    } finally {
      this.isBuilding = false;
      if (this.shouldRebuild) {
        this.shouldRebuild = false;
        this.scheduleBuild();
      }
    }
  }

  private async refreshWatcher() {
    const cssOptions = this.context.aukletConfig ?? {};
    const sourceDir =
      cssOptions.source ??
      cssOptions.sourceDir ??
      this.context.sourceDir ??
      aukletDefaultCssOptions.source;
    const sourceRoot = path.join(this.context.packageRoot, sourceDir);
    const configPath = path.join(this.context.packageRoot, aukletConfigFile);
    const watchPaths = [sourceRoot, configPath].filter((file) =>
      fs.existsSync(file),
    );

    await this.watcher?.close();

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      interval: 300,
      usePolling: true,
    });
    this.watcher.on('all', () => {
      this.scheduleBuild();
    });
    this.watcher.on('error', (error: unknown) => {
      this.logger?.error?.(error);
    });
  }

  private scheduleBuild() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rebuild().catch((error) => {
        this.logger?.error?.(error);
      });
    }, 80);
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
