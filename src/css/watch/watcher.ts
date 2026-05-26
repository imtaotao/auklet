import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { aukletConfigFile, aukletDefaultOptions } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { ModuleStyleBuilder } from '#auklet/css/production/builder';
import type {
  ModuleStyleBuildConfig,
  ModuleStyleBuildContext,
} from '#auklet/types';

export class ModuleStyleWatcher {
  private readonly context: ModuleStyleBuildContext & { packageRoot: string };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isBuilding = false;
  private shouldRebuild = false;
  private watcher: FSWatcher | null = null;

  constructor(
    context: ModuleStyleBuildContext = {},
    private readonly config: ModuleStyleBuildConfig = moduleStyleBuildConfig,
  ) {
    this.context = {
      packageRoot: process.cwd(),
      ...context,
    };
  }

  async watch() {
    await this.rebuild();
  }

  private async rebuild() {
    if (this.isBuilding) {
      this.shouldRebuild = true;
      return;
    }
    this.isBuilding = true;
    try {
      const builder = new ModuleStyleBuilder(this.context, this.config);
      await builder.build();
      await this.refreshWatcher();
    } catch (error) {
      // Watch mode keeps running after transient build or watcher errors.
    } finally {
      this.isBuilding = false;
      if (this.shouldRebuild) {
        this.shouldRebuild = false;
        this.scheduleBuild();
      }
    }
  }

  private async refreshWatcher() {
    const aukletConfig = this.context.aukletConfig ?? {};
    const sourceDir =
      this.context.source ?? aukletConfig.source ?? aukletDefaultOptions.source;
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
    this.watcher.on('all', (_event, file) => {
      if (typeof file === 'string' && !this.shouldRebuildForFile(file)) {
        return;
      }
      this.scheduleBuild();
    });
    this.watcher.on('error', () => undefined);
  }

  private scheduleBuild() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, 80);
  }

  private shouldRebuildForFile(file: string) {
    if (path.basename(file) === aukletConfigFile) return true;
    if (SOURCE_MODULE_RE.test(file)) return true;
    return this.config.styleExtensions.includes(path.extname(file));
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
  }
}
