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
import {
  createSharedStyleFileKeySet,
  resolveSharedOutputExcludeRoots,
} from '#auklet/css/core/style/shared';
import {
  getThemeNames,
  resolveThemeStyleFiles,
} from '#auklet/css/core/style/dependencies';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  fileWalker,
  getSourceModuleDir,
  isInsideRoot,
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
  private readonly scannedStyleFiles: Array<string>;
  private resolvedStyleFiles: Array<string>;
  private readonly sourceModuleDirs: Set<string>;
  private readonly themeStyleFileKeys: Set<string>;
  private readonly sharedStyleFileKeys: Set<string>;
  private hasValidatedSourceRootLocalStyleImports = false;
  private hasValidatedPreservedLocalStyleImports = false;
  private hasResolvedModuleOnlyStyleFiles = false;
  private moduleStyleEntryPlanner?: StyleModuleEntryPlanner;
  private moduleStyleImports?: Map<string, Array<string>>;

  constructor(private readonly options: StylePackageContextOptions) {
    const { config, context, normalizedConfig } = this.options;

    this.normalizedConfig = normalizedConfig;
    this.sourceRoot = path.join(context.packageRoot, context.sourceDir);
    this.resolver = new WorkspaceStyleResolver(config, context);
    this.styleProcessor = new StyleProcessor(config, this.resolver, {
      prefix: normalizedConfig.styles.prefix,
    });
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
    const styleLikeFiles = this.getStyleFiles(this.sourceFiles);
    const sharedInnerKeys = createSharedStyleFileKeySet({
      packageRoot: context.packageRoot,
      sourceRoot: this.sourceRoot,
      styleFiles: styleLikeFiles,
      patterns: normalizedConfig.styles.shared.inner,
    });
    // output globs only match *.module.* (already stripped from styleLikeFiles).
    // Exclude those directory trees so sibling helpers (e.g. helpers.css) do not
    // become package/module global entries; keep them on the @import allowlist.
    const sharedOutputExcludeRoots = resolveSharedOutputExcludeRoots({
      packageRoot: context.packageRoot,
      sourceRoot: this.sourceRoot,
      patterns: normalizedConfig.styles.shared.output,
    });
    this.scannedStyleFiles = styleLikeFiles.filter((styleFile) => {
      const key = normalizeFileKey(styleFile);
      if (sharedInnerKeys.has(key)) return true;
      return !sharedOutputExcludeRoots.some((root) =>
        isInsideRoot(styleFile, root),
      );
    });
    this.resolvedStyleFiles = this.scannedStyleFiles;
    this.sharedStyleFileKeys = new Set([
      ...sharedInnerKeys,
      ...styleLikeFiles
        .filter((styleFile) =>
          sharedOutputExcludeRoots.some((root) =>
            isInsideRoot(styleFile, root),
          ),
        )
        .map((styleFile) => normalizeFileKey(styleFile)),
    ]);
  }

  get styleFiles() {
    return this.resolvedStyleFiles;
  }

  getStyleFiles(files: Array<string>) {
    return files
      .filter((file) =>
        this.options.config.styleExtensions.includes(path.extname(file)),
      )
      .filter((styleFile) => !isCssModuleFile(styleFile))
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

  invalidateModuleStyleImports() {
    this.moduleStyleImports = undefined;
    this.moduleStyleEntryPlanner = undefined;
  }

  invalidateStyleContentCaches() {
    this.moduleStyleEntryPlanner = undefined;
    this.hasValidatedSourceRootLocalStyleImports = false;
    this.hasValidatedPreservedLocalStyleImports = false;
    this.hasResolvedModuleOnlyStyleFiles = false;
    this.resolvedStyleFiles = this.scannedStyleFiles;
    this.styleProcessor.clearLessCache();
  }

  async prepareStyleLanguage() {
    await this.resolveModuleOnlyStyleFiles();
    await this.styleProcessor.warmLessCache([
      ...this.styleFiles,
      ...this.themeFiles.values(),
    ]);
  }

  async getModuleStyleEntryPlanner() {
    this.moduleStyleEntryPlanner ??= await StyleModuleEntryPlanner.create(this);
    return this.moduleStyleEntryPlanner;
  }

  async getStyleEntryFiles() {
    const importedStyleFiles =
      await this.styleProcessor.collectImportedStyleFiles(this.styleFiles);
    return this.styleFiles.filter(
      (styleFile) => !importedStyleFiles.has(path.resolve(styleFile)),
    );
  }

  isSharedStyleFile(file: string) {
    return this.sharedStyleFileKeys.has(normalizeFileKey(file));
  }

  shouldAllowSharedStyleImport(reference: StyleFileImportReference) {
    return (
      (this.isSharedStyleFile(reference.imported) &&
        this.isSharedHelperStyleFile(reference.imported)) ||
      (this.isSharedStyleFile(reference.importer) &&
        this.isSharedHelperStyleFile(reference.imported))
    );
  }

  async assertPreservedLocalStyleImports() {
    if (this.hasValidatedPreservedLocalStyleImports) return;
    await this.assertNoSourceRootEscapingLocalStyleImports();
    await this.styleProcessor.assertNoLocalStyleImportCycles(this.styleFiles);
    this.hasValidatedPreservedLocalStyleImports = true;
  }

  async assertNoSourceRootEscapingLocalStyleImports() {
    if (this.hasValidatedSourceRootLocalStyleImports) return;
    await this.styleProcessor.assertNoSourceRootEscapingLocalStyleImports([
      ...this.styleFiles,
      ...this.themeFiles.values(),
    ]);
    this.hasValidatedSourceRootLocalStyleImports = true;
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

  private async resolveModuleOnlyStyleFiles() {
    if (this.hasResolvedModuleOnlyStyleFiles) return;

    const cssModuleFiles = this.sourceFiles.filter((file) =>
      isCssModuleFile(file),
    );
    if (cssModuleFiles.length === 0) {
      this.hasResolvedModuleOnlyStyleFiles = true;
      return;
    }

    const moduleReferenced = new Set<string>();
    for (const moduleFile of cssModuleFiles) {
      if (moduleFile.endsWith('.module.less')) {
        for (const imported of await this.styleProcessor.collectLessImportFiles(
          moduleFile,
        )) {
          moduleReferenced.add(normalizeFileKey(imported));
        }
      }
    }

    if (moduleReferenced.size === 0) {
      this.hasResolvedModuleOnlyStyleFiles = true;
      return;
    }

    const globalImported = new Set(
      Array.from(
        await this.styleProcessor.collectImportedStyleFiles(
          this.scannedStyleFiles,
        ),
        normalizeFileKey,
      ),
    );
    const nextStyleFiles = this.scannedStyleFiles.filter((styleFile) => {
      const key = normalizeFileKey(styleFile);
      if (!moduleReferenced.has(key)) return true;
      // Plain .css partials keep the existing global source-copy output path.
      // Only Less partials compiled by CSS Modules are excluded here.
      if (path.extname(styleFile).toLowerCase() !== '.less') return true;
      return globalImported.has(key);
    });

    this.resolvedStyleFiles = nextStyleFiles;
    if (nextStyleFiles.length !== this.scannedStyleFiles.length) {
      this.moduleStyleEntryPlanner = undefined;
    }

    this.hasResolvedModuleOnlyStyleFiles = true;
  }
}
