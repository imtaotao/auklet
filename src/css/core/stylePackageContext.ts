import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_MODULE_RE } from '#auklet/css/constants';
import { ModuleStyleImportCollector } from '#auklet/css/core/styleImports/collector';
import { StyleModuleEntryPlanner } from '#auklet/css/core/styleModuleEntryPlanner';
import {
  type StyleFileImportReference,
  StyleProcessor,
} from '#auklet/css/core/styleProcessor';
import { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { createStyleFileKeySet } from '#auklet/css/core/style/files';
import { createSharedStyleFileKeySet } from '#auklet/css/core/style/shared';
import {
  getThemeNames,
  resolveThemeStyleFiles,
} from '#auklet/css/core/style/dependencies';
import {
  fileWalker,
  getSourceModuleDir,
  normalizeFileKey,
  toPosixPath,
} from '#auklet/utils';
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
  private readonly sourceModuleDirs: Set<string>;
  private readonly themeStyleFileKeys: Set<string>;
  private readonly sharedStyleFileKeys: Set<string>;
  private moduleStyleEntryPlanner?: StyleModuleEntryPlanner;
  private moduleStyleImports?: Map<string, Array<string>>;

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
    this.themeStyleFileKeys = createStyleFileKeySet(this.themeFiles.values());
    this.sourceModuleDirs = this.getSourceModuleDirs(this.sourceFiles);
    this.styleFiles = this.getStyleFiles(this.sourceFiles);
    this.sharedStyleFileKeys = createSharedStyleFileKeySet({
      packageRoot: context.packageRoot,
      sourceRoot: this.sourceRoot,
      styleFiles: this.styleFiles,
      patterns: normalizedConfig.styles.shared,
    });
  }

  getStyleFiles(files: Array<string>) {
    return files
      .filter((file) =>
        this.options.config.styleExtensions.includes(path.extname(file)),
      )
      .filter(
        (styleFile) =>
          !this.themeStyleFileKeys.has(normalizeFileKey(styleFile)),
      );
  }

  getModuleStyleImports() {
    this.moduleStyleImports ??= this.importCollector.collect(
      this.sourceFiles,
      this.normalizedConfig,
    );
    return this.moduleStyleImports;
  }

  getModuleStyleEntryPlanner() {
    this.moduleStyleEntryPlanner ??= new StyleModuleEntryPlanner(this);
    return this.moduleStyleEntryPlanner;
  }

  isSharedStyleFile(file: string) {
    return this.sharedStyleFileKeys.has(normalizeFileKey(file));
  }

  shouldInlineSharedStyleImport(reference: StyleFileImportReference) {
    return (
      (this.isSharedStyleFile(reference.imported) &&
        this.isSharedHelperStyleFile(reference.imported)) ||
      (this.isSharedStyleFile(reference.importer) &&
        this.isSharedHelperStyleFile(reference.imported))
    );
  }

  private isSharedHelperStyleFile(file: string) {
    return (
      this.isInsideSourceRoot(file) &&
      !this.isThemeStyleFile(file) &&
      !this.isSourceModuleStyleFile(file)
    );
  }

  private getSourceModuleDirs(files: Array<string>) {
    return new Set(
      files
        .filter((file) => SOURCE_MODULE_RE.test(file))
        .map((sourceFile) =>
          toPosixPath(
            getSourceModuleDir(path.relative(this.sourceRoot, sourceFile)),
          ),
        ),
    );
  }

  private isSourceModuleStyleFile(file: string) {
    const sourceRelative = this.toSourceRelativePath(file);
    if (!sourceRelative) return false;

    const styleModuleDir = toPosixPath(getSourceModuleDir(sourceRelative));
    if (this.sourceModuleDirs.has(styleModuleDir)) return true;

    for (const sourceModuleDir of this.sourceModuleDirs) {
      if (sourceRelative.startsWith(`${sourceModuleDir}/`)) return true;
    }
    return false;
  }

  private isThemeStyleFile(file: string) {
    return this.themeStyleFileKeys.has(normalizeFileKey(file));
  }

  private isInsideSourceRoot(file: string) {
    return this.toSourceRelativePath(file) !== null;
  }

  private toSourceRelativePath(file: string) {
    const relative = path.relative(this.sourceRoot, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return toPosixPath(relative);
  }
}
