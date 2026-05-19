import fs from 'node:fs';
import path from 'node:path';
import { moduleCssBuildConfig } from '#auklet/css/core/config';
import { aukletDefaultCssOptions } from '#auklet/config';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import { ModuleStyleImportCollector } from '#auklet/css/core/moduleStyleImportCollector';
import type {
  CssOptions,
  AukletLogger,
  ModuleCssBuildConfig,
  ModuleCssBuildContext,
  ModuleCssBuildOptions,
  ResolvedModuleCssBuildContext,
} from '#auklet/types';
import {
  THEMES_DIR,
  createStyleFileKey,
  createStyleFileKeySet,
  groupStyleFilesByDir,
  getExternalStyleDependencies,
  getGlobalStyleDependencies,
  getThemeStyleDependencies,
  resolveThemeStyleFiles,
} from '#auklet/css/core/styleEntry';
import { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { fileWalker, getSourceModuleDir, toPosixPath } from '#auklet/utils';

const EMPTY_MODULE_STYLE_ENTRY_COMMENT =
  '/* Empty style entry kept so automated tooling can resolve this module CSS path. */\n';

export class ModuleCssBuilder {
  private readonly context: ModuleCssBuildContext & { packageRoot: string };
  private readonly logger?: AukletLogger;
  private srcRoot: string;
  private resolver: WorkspaceStyleResolver;
  private styleProcessor: StyleProcessor;
  private importCollector: ModuleStyleImportCollector;

  constructor(
    context: ModuleCssBuildContext = {},
    private readonly config: ModuleCssBuildConfig = moduleCssBuildConfig,
  ) {
    this.context = {
      packageRoot: process.cwd(),
      sourceDir: context.sourceDir,
      outputDir: context.outputDir,
      ...context,
    };
    this.logger = context.logger;
    this.applyContext(this.createBuildContext({}));
  }

  async build(options: ModuleCssBuildOptions = {}) {
    const cssOptions = options.aukletConfig ?? this.context.aukletConfig ?? {};
    const logger = options.logger ?? this.logger;
    const context = this.createBuildContext(cssOptions);

    this.applyContext(context);

    logger?.log?.(`[auklet:css] build ${path.basename(context.packageRoot)}`);

    const sourceFiles = fileWalker(this.srcRoot);
    const themeFiles = resolveThemeStyleFiles(cssOptions, context.packageRoot);
    const themeFileKeys = createStyleFileKeySet(themeFiles.values());
    const styleFiles = this.getStyleFiles(sourceFiles).filter(
      (styleFile) => !themeFileKeys.has(createStyleFileKey(styleFile)),
    );
    const moduleStyleImports = this.importCollector.collect(
      sourceFiles,
      cssOptions,
    );
    const outputs: Array<string> = [];
    const packageStyle = this.writePackageStyles(
      styleFiles,
      themeFiles,
      cssOptions,
      context,
    );
    if (packageStyle) outputs.push(packageStyle);

    for (const format of this.config.output.outputFormats) {
      const outRoot = path.join(context.packageRoot, context.outputDir, format);
      this.cleanThemeStyles(outRoot);
      this.copyStyleFiles(styleFiles, outRoot);
      const themeStyles = this.writeThemeStyles(themeFiles, outRoot);
      const themeEntries = this.writeThemeEntries(
        themeStyles,
        outRoot,
        cssOptions,
      );
      const externalStyle = this.writeExternalStyle(outRoot, cssOptions);
      const moduleStyle = this.writeModuleStyle(styleFiles, outRoot);
      const entryStyle = this.writeEntryStyle(
        outRoot,
        cssOptions,
        themeStyles.map((themeStyle) => themeStyle.file),
        moduleStyle,
      );

      outputs.push(...themeStyles.map((themeStyle) => themeStyle.file));
      outputs.push(...themeEntries);
      if (externalStyle) outputs.push(externalStyle);
      if (moduleStyle) outputs.push(moduleStyle);
      if (entryStyle) outputs.push(entryStyle);
      outputs.push(
        ...this.writeComponentStyleEntries(
          sourceFiles,
          styleFiles,
          outRoot,
          moduleStyleImports,
        ),
      );
    }

    logger?.log?.(
      `[auklet:css] ${styleFiles.length} source style file(s), ${outputs.length} output entry file(s)`,
    );
    for (const output of outputs) {
      logger?.log?.(
        `[auklet:css] + ${toPosixPath(
          path.relative(context.packageRoot, output),
        )}`,
      );
    }
  }

  private getStyleFiles(files: Array<string>) {
    return files.filter((file) =>
      this.config.styleExtensions.includes(path.extname(file)),
    );
  }

  private createBuildContext(cssOptions: CssOptions) {
    return {
      packageRoot: this.context.packageRoot,
      sourceDir:
        cssOptions.sourceDir ??
        this.context.sourceDir ??
        aukletDefaultCssOptions.sourceDir,
      outputDir:
        cssOptions.outputDir ??
        this.context.outputDir ??
        aukletDefaultCssOptions.outputDir,
    };
  }

  private applyContext(context: ResolvedModuleCssBuildContext) {
    this.srcRoot = path.join(context.packageRoot, context.sourceDir);
    this.resolver = new WorkspaceStyleResolver(this.config, context);
    this.styleProcessor = new StyleProcessor(this.config, this.resolver);
    this.importCollector = new ModuleStyleImportCollector(
      this.srcRoot,
      context.packageRoot,
      this.resolver,
      this.config.styleExtensions,
    );
  }

  private copyStyleFiles(files: Array<string>, outRoot: string) {
    for (const sourceFile of files) {
      const relative = path.relative(this.srcRoot, sourceFile);
      const target = path.join(outRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(sourceFile, target);
    }
  }

  private writePackageStyles(
    styleFiles: Array<string>,
    themeFiles: Map<string, string>,
    buildConfig: CssOptions,
    context: ResolvedModuleCssBuildContext,
  ) {
    const seen = new Set<string>();
    const root = this.styleProcessor.createRoot();

    for (const cssPath of themeFiles.values()) {
      const content = this.styleProcessor.readStyleFile(cssPath, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, cssPath);
      }
    }

    for (const specifier of getGlobalStyleDependencies(buildConfig)) {
      const cssPath = this.resolver.resolveStyleDependency(specifier);
      if (!cssPath) continue;
      const content = this.styleProcessor.readStyleFile(cssPath, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, cssPath);
      }
    }

    for (const styleFile of styleFiles) {
      const content = this.styleProcessor.readStyleFile(styleFile, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, styleFile);
      }
    }

    if (!root.nodes?.length) return null;

    fs.mkdirSync(path.join(context.packageRoot, context.outputDir), {
      recursive: true,
    });
    const target = path.join(
      context.packageRoot,
      context.outputDir,
      this.config.output.indexCssFile,
    );
    fs.writeFileSync(target, this.styleProcessor.stringify(root));
    return target;
  }

  private writeEntryStyle(
    outRoot: string,
    buildConfig: CssOptions,
    themeStyles: Array<string>,
    moduleStyle: string | null,
  ) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.indexCssFile,
    );
    const root = this.styleProcessor.createRoot();
    const styleDir = path.dirname(target);

    for (const specifier of getGlobalStyleDependencies(buildConfig)) {
      this.styleProcessor.appendImportRule(root, specifier);
    }
    for (const style of [...themeStyles, moduleStyle]) {
      if (!style) continue;
      this.styleProcessor.appendImportRule(
        root,
        this.toRelativeImportSpecifier(styleDir, style),
      );
    }
    if (!root.nodes?.length) return null;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, this.styleProcessor.stringify(root));
    return target;
  }

  private writeThemeStyles(themeFiles: Map<string, string>, outRoot: string) {
    const outputs: Array<{ themeName: string; file: string }> = [];
    const themesDir = path.join(
      outRoot,
      this.config.output.styleDir,
      THEMES_DIR,
    );

    for (const [themeName, cssPath] of themeFiles) {
      const root = this.styleProcessor.createRoot();
      const content = this.styleProcessor.readStyleFile(cssPath);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, cssPath);
      }

      const target = path.join(themesDir, `${themeName}.css`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        root.nodes?.length ? this.styleProcessor.stringify(root) : '',
      );
      outputs.push({ themeName, file: target });
    }

    return outputs;
  }

  private writeThemeEntries(
    themeStyles: Array<{ themeName: string; file: string }>,
    outRoot: string,
    buildConfig: CssOptions,
  ) {
    const outputs: Array<string> = [];
    const themesDir = path.join(outRoot, THEMES_DIR);

    for (const { themeName, file } of themeStyles) {
      const target = path.join(themesDir, `${themeName}.css`);
      const root = this.styleProcessor.createRoot();
      const targetDir = path.dirname(target);

      for (const specifier of getThemeStyleDependencies(
        buildConfig,
        themeName,
      )) {
        this.styleProcessor.appendImportRule(root, specifier);
      }
      this.styleProcessor.appendImportRule(
        root,
        this.toRelativeImportSpecifier(targetDir, file),
      );

      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(target, this.styleProcessor.stringify(root));
      outputs.push(target);
    }

    return outputs;
  }

  private cleanThemeStyles(outRoot: string) {
    fs.rmSync(path.join(outRoot, THEMES_DIR), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(outRoot, this.config.output.styleDir, THEMES_DIR), {
      recursive: true,
      force: true,
    });
  }

  private writeModuleStyle(styleFiles: Array<string>, outRoot: string) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.moduleCssFile,
    );
    const seen = new Set<string>();
    const root = this.styleProcessor.createRoot();

    for (const styleFile of styleFiles) {
      const content = this.styleProcessor.readStyleFile(styleFile, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, styleFile);
      }
    }
    if (!root.nodes?.length) return null;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, this.styleProcessor.stringify(root));
    return target;
  }

  private writeExternalStyle(outRoot: string, buildConfig: CssOptions) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.externalCssFile,
    );
    const root = this.styleProcessor.createRoot();

    for (const specifier of getExternalStyleDependencies(buildConfig)) {
      this.styleProcessor.appendImportRule(
        root,
        this.resolver.toExternalStyleSpecifier(specifier, outRoot),
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      root.nodes?.length ? this.styleProcessor.stringify(root) : '',
    );
    return target;
  }

  private writeComponentStyleEntries(
    sourceFiles: Array<string>,
    styleFiles: Array<string>,
    outRoot: string,
    moduleStyleImports: Map<string, Array<string>>,
  ) {
    const styleFilesByDir = groupStyleFilesByDir(this.srcRoot, styleFiles);
    const importedStyleFiles =
      this.styleProcessor.collectImportedStyleFiles(styleFiles);
    const sourceModuleDirs = this.getSourceModuleDirs(sourceFiles);
    const ownStyleDirs = this.getOwnStyleDirs(
      styleFilesByDir,
      importedStyleFiles,
    );
    const sourceDirs = Array.from(
      new Set([
        ...sourceModuleDirs,
        ...ownStyleDirs,
        ...moduleStyleImports.keys(),
      ]),
    );
    const outputs: Array<string> = [];

    for (const sourceDir of sourceDirs) {
      if (sourceDir === '.') continue;

      const dirStyleFiles = styleFilesByDir.get(sourceDir) ?? [];
      const styleDir = path.join(
        outRoot,
        sourceDir,
        this.config.output.styleDir,
      );
      const target = path.join(styleDir, this.config.output.indexCssFile);
      const moduleStyleSpecifiers = this.getModuleStyleSpecifiers(
        moduleStyleImports.get(sourceDir) ?? [],
        styleDir,
      );
      const dirStyleSpecifiers = this.getDirStyleSpecifiers(
        dirStyleFiles,
        importedStyleFiles,
        styleDir,
        outRoot,
      );
      const sourceStyleSpecifiers = [
        ...moduleStyleSpecifiers,
        ...dirStyleSpecifiers,
      ];
      const root = this.styleProcessor.createRoot();
      const seen = new Set<string>();

      for (const specifier of sourceStyleSpecifiers) {
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        this.styleProcessor.appendImportRule(
          root,
          this.resolver.toOutputStyleSpecifier(specifier, outRoot),
        );
      }

      fs.mkdirSync(styleDir, { recursive: true });
      fs.writeFileSync(
        target,
        root.nodes?.length
          ? this.styleProcessor.stringify(root)
          : EMPTY_MODULE_STYLE_ENTRY_COMMENT,
      );
      outputs.push(target);
    }
    return outputs;
  }

  private getSourceModuleDirs(sourceFiles: Array<string>) {
    return sourceFiles
      .filter((sourceFile) => sourceFile.endsWith('.tsx'))
      .map((sourceFile) => {
        return getSourceModuleDir(path.relative(this.srcRoot, sourceFile));
      })
      .filter((sourceModuleDir) => {
        return toPosixPath(sourceModuleDir).split('/').length === 2;
      });
  }

  private getOwnStyleDirs(
    styleFilesByDir: Map<string, Array<string>>,
    importedStyleFiles: Set<string>,
  ) {
    return Array.from(styleFilesByDir.entries())
      .filter(([, dirStyleFiles]) =>
        dirStyleFiles.some(
          (styleFile) => !importedStyleFiles.has(path.resolve(styleFile)),
        ),
      )
      .map(([sourceDir]) => sourceDir);
  }

  private getModuleStyleSpecifiers(
    specifiers: Array<string>,
    styleDir: string,
  ) {
    return specifiers.map((specifier) => {
      if (specifier.startsWith('.')) return specifier;
      if (!path.isAbsolute(specifier)) return specifier;
      return toPosixPath(path.relative(styleDir, specifier));
    });
  }

  private getDirStyleSpecifiers(
    dirStyleFiles: Array<string>,
    importedStyleFiles: Set<string>,
    styleDir: string,
    outRoot: string,
  ) {
    return dirStyleFiles
      .filter((styleFile) => !importedStyleFiles.has(path.resolve(styleFile)))
      .map((styleFile) =>
        toPosixPath(
          path.relative(
            styleDir,
            path.join(outRoot, path.relative(this.srcRoot, styleFile)),
          ),
        ),
      );
  }

  private toRelativeImportSpecifier(fromDir: string, file: string) {
    const relative = toPosixPath(path.relative(fromDir, file));
    return relative.startsWith('.') ? relative : `./${relative}`;
  }
}
