import fs from 'node:fs';
import path from 'node:path';
import {
  aukletConfigFile,
  aukletDefaultCssOptions,
  normalizeAukletConfig,
} from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { moduleCssBuildConfig } from '#auklet/css/core/config';
import { ModuleStyleImportCollector } from '#auklet/css/core/moduleStyleImportCollector';
import {
  normalizeCssFileKey,
  toCssFsSpecifier,
  toCssWatchPath,
} from '#auklet/css/core/path';
import {
  createImportCode,
  EXTERNAL_ENTRY,
  createStyleFileKey,
  createStyleFileKeySet,
  getExternalStyleDependencies,
  getGlobalStyleDependencies,
  getThemeStyleDependencies,
  groupStyleFilesByDir,
  MODULE_ENTRY,
  parsePackageStyleSpecifier,
  removeCssExtension,
  resolveThemeStyleFiles,
  STYLE_ENTRY,
  THEMES_ENTRY_PREFIX,
} from '#auklet/css/core/styleEntry';
import { StyleProcessor } from '#auklet/css/core/styleProcessor';
import type {
  AukletConfig,
  ModuleCssBuildConfig,
  ResolvedModuleCssBuildContext,
  NormalizedAukletConfig,
} from '#auklet/types';
import { WorkspaceStyleResolver } from '#auklet/css/core/workspaceStyleResolver';
import { fileWalker, toPosixPath } from '#auklet/utils';

type PackageCssContext = {
  cssOptions: NormalizedAukletConfig;
  context: ResolvedModuleCssBuildContext;
  packageName: string;
  configPath: string;
  resolver: WorkspaceStyleResolver;
  sourceRoot: string;
  styleProcessor: StyleProcessor;
};

type PackageJsonLike = {
  name?: string;
};

const mergeLoadResults = (...results: Array<PackageCssLoadResult>) => {
  return {
    code: results
      .map((result) => result.code)
      .filter((code) => code.trim())
      .join('\n'),
    watchFiles: Array.from(
      new Set(results.flatMap((result) => result.watchFiles)),
    ),
  };
};

export interface ModuleCssGraphOptions {
  workspaceRoot: string;
  packagesDir?: string;
  config?: ModuleCssBuildConfig;
  loadAukletConfig?: (
    packageRoot: string,
    options?: { cacheBust?: boolean },
  ) => Promise<AukletConfig>;
}

export type PackageCssId = {
  packageName: string;
  cssPath: string;
};

export type PackageCssLoadResult = {
  code: string;
  watchFiles: Array<string>;
};

export class ModuleCssGraph {
  private readonly config: ModuleCssBuildConfig;
  private readonly workspaceRoot: string;
  private readonly packagesDir: string;
  private readonly loadAukletConfig: NonNullable<
    ModuleCssGraphOptions['loadAukletConfig']
  >;

  constructor(options: ModuleCssGraphOptions) {
    this.config = options.config ?? moduleCssBuildConfig;
    this.workspaceRoot = normalizeCssFileKey(options.workspaceRoot);
    this.packagesDir = options.packagesDir ?? 'packages';
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
  }

  parsePackageCssId(id: string) {
    return parsePackageCssId(id, this.getWorkspacePackageNames());
  }

  isWorkspaceSourceGraphFile(file: string) {
    const normalizedFile = normalizeCssFileKey(file);
    const packagesRoot = normalizeCssFileKey(
      path.join(this.workspaceRoot, this.packagesDir),
    );
    if (!normalizedFile.startsWith(`${packagesRoot}/`)) {
      return false;
    }
    if (normalizedFile.endsWith(aukletConfigFile)) return true;
    if (normalizedFile.endsWith('.ts') || normalizedFile.endsWith('.tsx')) {
      return true;
    }

    return this.config.styleExtensions.some((extension) =>
      normalizedFile.endsWith(extension),
    );
  }

  isCssConfigFile(file: string) {
    return normalizeCssFileKey(file).endsWith(aukletConfigFile);
  }

  isStyleFile(file: string) {
    return this.config.styleExtensions.includes(path.extname(file));
  }

  getWorkspacePackageNames() {
    return this.getWorkspacePackages().map((item) => item.packageName);
  }

  getWatchRoots() {
    const packagesRoot = path.join(this.workspaceRoot, this.packagesDir);
    return [
      toCssWatchPath(packagesRoot, '*', 'src'),
      toCssWatchPath(packagesRoot, '*', aukletConfigFile),
    ];
  }

  async createPackageCssCode(
    parsed: PackageCssId,
  ): Promise<PackageCssLoadResult> {
    const context = await this.createContext(parsed);
    if (!context) {
      return {
        code: '',
        watchFiles: [],
      };
    }

    if (parsed.cssPath === STYLE_ENTRY) {
      return this.createStyleCssCode(context);
    }
    if (parsed.cssPath === EXTERNAL_ENTRY) {
      return this.createExternalCssCode(context);
    }
    if (parsed.cssPath === MODULE_ENTRY) {
      return this.createModuleCssCode(context);
    }
    if (parsed.cssPath.startsWith(THEMES_ENTRY_PREFIX)) {
      return this.createThemeCssCode(context, parsed.cssPath);
    }
    return this.createSourceModuleCssCode(context, parsed.cssPath);
  }

  private async createContext(parsed: PackageCssId) {
    const workspacePackage = this.getWorkspacePackages().find(
      (item) => item.packageName === parsed.packageName,
    );
    if (!workspacePackage) return null;

    const packageRoot = workspacePackage.packageRoot;
    if (!fs.existsSync(packageRoot)) return null;

    const rawConfig = await this.loadAukletConfig(packageRoot, {
      cacheBust: true,
    });
    const cssOptions = normalizeAukletConfig(rawConfig);
    const context: ResolvedModuleCssBuildContext = {
      packageRoot,
      sourceDir:
        rawConfig.source ??
        rawConfig.sourceDir ??
        aukletDefaultCssOptions.source,
      outputDir:
        rawConfig.output ??
        rawConfig.outputDir ??
        aukletDefaultCssOptions.output,
    };
    const sourceRoot = path.join(packageRoot, context.sourceDir);
    const resolver = new WorkspaceStyleResolver(this.config, context);
    const styleProcessor = new StyleProcessor(this.config, resolver);

    return {
      cssOptions,
      context,
      packageName: parsed.packageName,
      configPath: path.join(packageRoot, aukletConfigFile),
      resolver,
      sourceRoot,
      styleProcessor,
    };
  }

  private async createStyleCssCode(context: PackageCssContext) {
    const dependencies = await this.createStyleDependencyCssCode(context);
    const themes = await this.createThemeCssCode(context, undefined, false);
    const module = this.createModuleCssCode(context);

    return mergeLoadResults(dependencies, themes, module);
  }

  private async createStyleDependencyCssCode(context: PackageCssContext) {
    const results: Array<PackageCssLoadResult> = [];
    const imports: Array<string> = [];

    for (const specifier of getGlobalStyleDependencies(context.cssOptions)) {
      const parsed = this.parsePackageCssId(specifier);
      if (parsed) {
        results.push(await this.createPackageCssCode(parsed));
        continue;
      }
      imports.push(specifier);
    }

    return mergeLoadResults(
      {
        code: createImportCode(imports),
        watchFiles: [context.configPath],
      },
      ...results,
    );
  }

  private async createExternalCssCode(context: PackageCssContext) {
    const results: Array<PackageCssLoadResult> = [];
    const imports: Array<string> = [];

    for (const specifier of getExternalStyleDependencies(context.cssOptions)) {
      const external = this.toDevExternalStyleSpecifier(specifier);
      const parsed = this.parsePackageCssId(external);
      if (parsed) {
        results.push(await this.createPackageCssCode(parsed));
        continue;
      }
      imports.push(external);
    }

    return mergeLoadResults(
      {
        code: createImportCode(imports),
        watchFiles: [context.configPath],
      },
      ...results,
    );
  }

  private async createThemeCssCode(
    context: PackageCssContext,
    cssPath?: string,
    includeDependencies = true,
  ) {
    const themeFiles = this.getThemeStyleFiles(context);
    const targetThemeName = cssPath
      ? removeCssExtension(cssPath.slice(THEMES_ENTRY_PREFIX.length))
      : null;
    const root = context.styleProcessor.createRoot();
    const watchFiles = [context.configPath, ...themeFiles.values()];
    const dependencyResults: Array<PackageCssLoadResult> = [];
    const imports: Array<string> = [];

    for (const [themeName, themeFile] of themeFiles) {
      if (targetThemeName && themeName !== targetThemeName) continue;
      if (includeDependencies) {
        for (const specifier of getThemeStyleDependencies(
          context.cssOptions,
          themeName,
        )) {
          const parsed = this.parsePackageCssId(specifier);
          if (!parsed) {
            imports.push(specifier);
            continue;
          }
          dependencyResults.push(await this.createPackageCssCode(parsed));
        }
      }
      const content = context.styleProcessor.readStyleFile(themeFile);
      if (content.trim()) {
        context.styleProcessor.appendStyleContent(root, content, themeFile);
      }
    }

    return mergeLoadResults(
      {
        code: createImportCode(imports),
        watchFiles,
      },
      ...dependencyResults,
      {
        code: root.nodes?.length ? context.styleProcessor.stringify(root) : '',
        watchFiles: [],
      },
    );
  }

  private getThemeStyleFiles(context: PackageCssContext) {
    return resolveThemeStyleFiles(
      context.cssOptions,
      context.context.packageRoot,
    );
  }

  private createModuleCssCode(context: PackageCssContext) {
    const themeFiles = this.getThemeStyleFiles(context);
    const themeFileKeys = createStyleFileKeySet(themeFiles.values());
    const styleFiles = this.getStyleFiles(context.sourceRoot).filter(
      (styleFile) => !themeFileKeys.has(createStyleFileKey(styleFile)),
    );
    const root = context.styleProcessor.createRoot();
    const seen = new Set<string>();

    for (const styleFile of styleFiles) {
      const content = context.styleProcessor.readStyleFile(styleFile, seen);
      if (content.trim()) {
        context.styleProcessor.appendStyleContent(root, content, styleFile);
      }
    }

    return {
      code: root.nodes?.length ? context.styleProcessor.stringify(root) : '',
      watchFiles: [context.configPath, ...styleFiles],
    };
  }

  private async createSourceModuleCssCode(
    context: PackageCssContext,
    cssPath: string,
  ) {
    const sourceModuleDir = removeCssExtension(cssPath);
    const themeFiles = this.getThemeStyleFiles(context);
    const themeFileKeys = createStyleFileKeySet(themeFiles.values());
    const styleFiles = this.getStyleFiles(context.sourceRoot).filter(
      (styleFile) => !themeFileKeys.has(createStyleFileKey(styleFile)),
    );
    const styleFilesByDir = groupStyleFilesByDir(
      context.sourceRoot,
      styleFiles,
    );
    const importedStyleFiles =
      context.styleProcessor.collectImportedStyleFiles(styleFiles);
    const importCollector = new ModuleStyleImportCollector(
      context.sourceRoot,
      context.context.packageRoot,
      context.resolver,
      this.config.styleExtensions,
    );
    const sourceFiles = fileWalker(context.sourceRoot);
    const moduleStyleImports = importCollector.collect(
      sourceFiles,
      context.cssOptions,
    );
    const sourceStyleDir = path.join(
      context.sourceRoot,
      sourceModuleDir,
      this.config.output.styleDir,
    );
    const moduleStyleResults: Array<PackageCssLoadResult> = [];
    const moduleStyleSpecifiers: Array<string> = [];

    for (const specifier of moduleStyleImports.get(sourceModuleDir) ?? []) {
      const result = this.toDevModuleImportSpecifier(
        context,
        sourceStyleDir,
        specifier,
      );
      const parsed = this.parsePackageCssId(result);
      if (parsed) {
        moduleStyleResults.push(await this.createPackageCssCode(parsed));
        continue;
      }
      moduleStyleSpecifiers.push(result);
    }

    const ownStyleFiles = (styleFilesByDir.get(sourceModuleDir) ?? []).filter(
      (styleFile) => !importedStyleFiles.has(path.resolve(styleFile)),
    );
    const root = context.styleProcessor.createRoot();
    const seen = new Set<string>();

    for (const ownStyleFile of ownStyleFiles) {
      const content = context.styleProcessor.readStyleFile(ownStyleFile, seen);
      if (content.trim()) {
        context.styleProcessor.appendStyleContent(root, content, ownStyleFile);
      }
    }
    const ownStyleCode = root.nodes?.length
      ? context.styleProcessor.stringify(root)
      : '';

    return mergeLoadResults(...moduleStyleResults, {
      code: [createImportCode(moduleStyleSpecifiers), ownStyleCode]
        .filter((code) => code.trim())
        .join('\n'),
      watchFiles: [
        context.configPath,
        ...styleFiles,
        ...sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file)),
      ],
    });
  }

  private getStyleFiles(sourceRoot: string) {
    if (!fs.existsSync(sourceRoot)) return [];
    return fileWalker(sourceRoot).filter((file) =>
      this.config.styleExtensions.includes(path.extname(file)),
    );
  }

  private toDevModuleImportSpecifier(
    context: PackageCssContext,
    sourceStyleDir: string,
    specifier: string,
  ) {
    if (!specifier.startsWith('.')) {
      return this.toDevExternalStyleSpecifier(specifier);
    }

    const outputStyleEntry = path.resolve(sourceStyleDir, specifier);
    const styleEntrySuffix = `${path.sep}${this.config.output.styleDir}${path.sep}${this.config.output.indexCssFile}`;
    if (!outputStyleEntry.endsWith(styleEntrySuffix)) {
      return toCssFsSpecifier(outputStyleEntry);
    }

    const sourceModuleDir = path.relative(
      context.sourceRoot,
      outputStyleEntry.slice(0, -styleEntrySuffix.length),
    );
    return `${context.packageName}/${toPosixPath(sourceModuleDir)}.css`;
  }

  private toDevExternalStyleSpecifier(specifier: string) {
    const parsed = parsePackageStyleSpecifier(specifier);
    if (!parsed) return specifier;

    if (this.isWorkspacePackageName(parsed.packageName)) {
      if (parsed.stylePath === STYLE_ENTRY) {
        return `${parsed.packageName}/${EXTERNAL_ENTRY}`;
      }
      if (
        parsed.stylePath ===
        [this.config.output.styleDir, this.config.output.indexCssFile].join('/')
      ) {
        return `${parsed.packageName}/${EXTERNAL_ENTRY}`;
      }
    }
    return specifier;
  }

  private isWorkspacePackageName(packageName: string) {
    return this.getWorkspacePackageNames().includes(packageName);
  }

  private getWorkspacePackages() {
    const packagesRoot = path.join(this.workspaceRoot, this.packagesDir);
    if (!fs.existsSync(packagesRoot)) return [];

    return fs
      .readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const packageRoot = path.join(packagesRoot, entry.name);
        const packageJsonPath = path.join(packageRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) return [];

        const pkg = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8'),
        ) as PackageJsonLike;
        if (!pkg.name) return [];

        return [
          {
            packageName: pkg.name,
            packageRoot,
          },
        ];
      });
  }
}

export function parsePackageCssId(
  id: string,
  packageNames: Array<string>,
): PackageCssId | null {
  if (!id.endsWith('.css')) {
    return null;
  }

  const packageName = [...packageNames]
    .sort((left, right) => right.length - left.length)
    .find((name) => id.startsWith(`${name}/`));
  if (!packageName) return null;

  return {
    packageName,
    cssPath: id.slice(packageName.length + 1),
  };
}
