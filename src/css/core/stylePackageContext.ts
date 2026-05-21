import fs from 'node:fs';
import path from 'node:path';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import {
  createStyleFileKey,
  createStyleFileKeySet,
} from '#auklet/css/core/style/files';
import {
  getThemeNames,
  resolveThemeStyleFiles,
} from '#auklet/css/core/style/dependencies';
import { fileWalker } from '#auklet/utils';
import type {
  ModuleStyleBuildConfig,
  NormalizedAukletConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export type StylePackageContextOptions = {
  config: ModuleStyleBuildConfig;
  context: ResolvedModuleStyleBuildContext;
  normalizedConfig: NormalizedAukletConfig;
};

export class StylePackageContext {
  readonly normalizedConfig: NormalizedAukletConfig;
  readonly sourceRoot: string;
  readonly resolver: WorkspaceStyleResolver;
  readonly styleProcessor: StyleProcessor;
  readonly importCollector: ModuleStyleImportCollector;
  readonly sourceFiles: Array<string>;
  readonly themeFiles: Map<string, string>;
  readonly themeNames: Array<string>;
  readonly styleFiles: Array<string>;

  constructor(private readonly options: StylePackageContextOptions) {
    const { config, context, normalizedConfig } = this.options;

    this.normalizedConfig = normalizedConfig;
    this.sourceRoot = path.join(context.packageRoot, context.sourceDir);
    this.resolver = new WorkspaceStyleResolver(config, context);
    this.styleProcessor = new StyleProcessor(config, this.resolver);
    this.importCollector = new ModuleStyleImportCollector(
      this.sourceRoot,
      context.packageRoot,
      this.resolver,
      config.styleExtensions,
    );
    this.sourceFiles = fs.existsSync(this.sourceRoot)
      ? fileWalker(this.sourceRoot)
      : [];
    this.themeFiles = resolveThemeStyleFiles(
      normalizedConfig,
      context.packageRoot,
    );
    this.themeNames = getThemeNames(normalizedConfig);
    this.styleFiles = this.getStyleFiles(this.sourceFiles);
  }

  getStyleFiles(files: Array<string>) {
    const themeFileKeys = createStyleFileKeySet(this.themeFiles.values());

    return files
      .filter((file) =>
        this.options.config.styleExtensions.includes(path.extname(file)),
      )
      .filter((styleFile) => !themeFileKeys.has(createStyleFileKey(styleFile)));
  }
}
