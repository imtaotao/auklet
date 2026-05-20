import path from 'node:path';
import { aukletConfigFile } from '#auklet/config';
import { loadAukletConfig } from '#auklet/configLoader';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import {
  ModuleStyleGraphRequestCache,
  type LoadAukletConfig,
  type PackageStyleContext,
} from '#auklet/css/core/moduleGraphRequestCache';
import { StyleModuleEntryPlanner } from '#auklet/css/core/styleModuleEntryPlanner';
import {
  EXTERNAL_ENTRY,
  MODULE_ENTRY,
  STYLE_ENTRY,
  THEMES_ENTRY_PREFIX,
} from '#auklet/css/constants';
import {
  createExternalEntryParts,
  createStyleEntryParts,
  createThemeEntryParts,
} from '#auklet/css/core/style/plan';
import {
  createImportCode,
  parsePackageStyleSpecifier,
  removeStyleExtension,
} from '#auklet/css/core/style/specifier';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import {
  normalizeFileKey,
  toFsSpecifier,
  toPosixPath,
  toWatchPath,
} from '#auklet/utils';

const mergeLoadResults = (...results: Array<PackageStyleLoadResult>) => {
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

export interface ModuleStyleGraphOptions {
  workspaceRoot: string;
  packagesDir?: string;
  config?: ModuleStyleBuildConfig;
  loadAukletConfig?: LoadAukletConfig;
}

export type PackageStyleId = {
  packageName: string;
  stylePath: string;
};

export type PackageStyleLoadResult = {
  code: string;
  watchFiles: Array<string>;
};

export class ModuleStyleGraph {
  private readonly config: ModuleStyleBuildConfig;
  private readonly workspaceRoot: string;
  private readonly packagesDir: string;
  private readonly loadAukletConfig: LoadAukletConfig;

  constructor(options: ModuleStyleGraphOptions) {
    this.config = options.config ?? moduleStyleBuildConfig;
    this.workspaceRoot = normalizeFileKey(options.workspaceRoot);
    this.packagesDir = options.packagesDir ?? 'packages';
    this.loadAukletConfig = options.loadAukletConfig ?? loadAukletConfig;
  }

  parsePackageStyleId(id: string) {
    return parsePackageStyleId(id, this.getWorkspacePackageNames());
  }

  isWorkspaceSourceGraphFile(file: string) {
    const normalizedFile = normalizeFileKey(file);
    const packagesRoot = normalizeFileKey(
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

  isStyleConfigFile(file: string) {
    return normalizeFileKey(file).endsWith(aukletConfigFile);
  }

  isStyleFile(file: string) {
    return this.config.styleExtensions.includes(path.extname(file));
  }

  getWorkspacePackageNames() {
    return this.createRequestCache().getWorkspacePackageNames();
  }

  getWatchRoots() {
    const packagesRoot = path.join(this.workspaceRoot, this.packagesDir);
    return [
      toWatchPath(packagesRoot, '*', 'src'),
      toWatchPath(packagesRoot, '*', aukletConfigFile),
    ];
  }

  async createPackageStyleCode(parsed: PackageStyleId) {
    return this.createPackageStyleCodeWithCache(
      parsed,
      this.createRequestCache(),
    );
  }

  private async createPackageStyleCodeWithCache(
    parsed: PackageStyleId,
    cache: ModuleStyleGraphRequestCache,
  ) {
    const context = await cache.getContext(parsed);
    if (!context) {
      return {
        code: '',
        watchFiles: [],
      };
    }

    if (parsed.stylePath === STYLE_ENTRY) {
      return this.createStyleCode(context, cache);
    }
    if (parsed.stylePath === EXTERNAL_ENTRY) {
      return this.createExternalStyleCode(context, cache);
    }
    if (parsed.stylePath === MODULE_ENTRY) {
      return this.createModuleStyleCode(context);
    }
    if (parsed.stylePath.startsWith(THEMES_ENTRY_PREFIX)) {
      return this.createThemeStyleCode(context, cache, [
        removeStyleExtension(
          parsed.stylePath.slice(THEMES_ENTRY_PREFIX.length),
        ),
      ]);
    }
    return this.createSourceModuleStyleCode(context, cache, parsed.stylePath);
  }

  private async createStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
  ) {
    const results: Array<PackageStyleLoadResult> = [];

    for (const part of createStyleEntryParts(context.normalizedConfig)) {
      if (part.type === 'dependencies') {
        results.push(
          await this.createDependencyStyleCode(context, cache, part.specifiers),
        );
        continue;
      }
      if (part.type === 'themes') {
        results.push(
          await this.createThemeStyleCode(
            context,
            cache,
            part.themeNames,
            false,
          ),
        );
        continue;
      }
      results.push(this.createModuleStyleCode(context));
    }

    return mergeLoadResults(...results);
  }

  private async createDependencyStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    specifiers: Array<string>,
    mapSpecifier: (specifier: string) => string = (specifier) => specifier,
  ) {
    const results: Array<PackageStyleLoadResult> = [];
    const imports: Array<string> = [];

    for (const specifier of specifiers) {
      const outputSpecifier = mapSpecifier(specifier);
      const parsed = this.parsePackageStyleIdInRequest(outputSpecifier, cache);
      if (parsed) {
        results.push(await this.createPackageStyleCodeWithCache(parsed, cache));
        continue;
      }
      imports.push(outputSpecifier);
    }

    return mergeLoadResults(
      {
        code: createImportCode(imports),
        watchFiles: [context.configPath],
      },
      ...results,
    );
  }

  private async createExternalStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
  ) {
    const results: Array<PackageStyleLoadResult> = [];

    for (const part of createExternalEntryParts(context.normalizedConfig)) {
      if (part.type === 'dependencies') {
        results.push(
          await this.createDependencyStyleCode(
            context,
            cache,
            part.specifiers,
            (specifier) => this.toDevExternalStyleSpecifier(specifier, cache),
          ),
        );
      }
    }

    return mergeLoadResults(...results);
  }

  private async createThemeStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    themeNames?: Array<string>,
    includeDependencies = true,
  ) {
    const { themeFiles } = context.packageContext;
    const targetThemeNames = themeNames ?? context.packageContext.themeNames;
    const root = context.styleProcessor.createRoot();
    const watchFiles = [context.configPath, ...themeFiles.values()];
    const dependencyResults: Array<PackageStyleLoadResult> = [];

    for (const themeName of targetThemeNames) {
      for (const part of createThemeEntryParts(
        context.normalizedConfig,
        themeName,
        {
          includeDependencies,
        },
      )) {
        if (part.type === 'dependencies') {
          dependencyResults.push(
            await this.createDependencyStyleCode(
              context,
              cache,
              part.specifiers,
            ),
          );
          continue;
        }

        const themeFile = themeFiles.get(part.themeName);
        if (!themeFile) continue;
        const content = context.styleProcessor.readStyleFile(themeFile);
        if (content.trim()) {
          context.styleProcessor.appendStyleContent(root, content, themeFile);
        }
      }
    }

    return mergeLoadResults(
      {
        code: '',
        watchFiles,
      },
      ...dependencyResults,
      {
        code: root.nodes?.length ? context.styleProcessor.stringify(root) : '',
        watchFiles: [],
      },
    );
  }

  private createModuleStyleCode(context: PackageStyleContext) {
    const { styleFiles } = context.packageContext;
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

  private async createSourceModuleStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    stylePath: string,
  ) {
    const sourceModuleDir = removeStyleExtension(stylePath);
    const { styleFiles, sourceFiles } = context.packageContext;
    const moduleStyleImports = context.packageContext.importCollector.collect(
      sourceFiles,
      context.normalizedConfig,
    );
    const entry = new StyleModuleEntryPlanner(
      context.packageContext,
    ).createEntry(sourceModuleDir, moduleStyleImports);
    const sourceStyleDir = path.join(
      context.sourceRoot,
      sourceModuleDir,
      this.config.output.styleDir,
    );
    const moduleStyleResults: Array<PackageStyleLoadResult> = [];
    const moduleStyleSpecifiers: Array<string> = [];

    for (const specifier of entry.moduleStyleImports) {
      const result = this.toDevModuleImportSpecifier(
        context,
        cache,
        sourceStyleDir,
        specifier,
      );
      const parsed = this.parsePackageStyleIdInRequest(result, cache);
      if (parsed) {
        moduleStyleResults.push(
          await this.createPackageStyleCodeWithCache(parsed, cache),
        );
        continue;
      }
      moduleStyleSpecifiers.push(result);
    }

    const root = context.styleProcessor.createRoot();
    const seen = new Set<string>();

    for (const ownStyleFile of entry.ownStyleFiles) {
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

  private toDevModuleImportSpecifier(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    sourceStyleDir: string,
    specifier: string,
  ) {
    if (!specifier.startsWith('.')) {
      return this.toDevExternalStyleSpecifier(specifier, cache);
    }

    const outputStyleEntry = path.resolve(sourceStyleDir, specifier);
    const styleEntrySuffix = `${path.sep}${this.config.output.styleDir}${path.sep}${this.config.output.indexStyleFile}`;
    if (!outputStyleEntry.endsWith(styleEntrySuffix)) {
      return toFsSpecifier(outputStyleEntry);
    }

    const sourceModuleDir = path.relative(
      context.sourceRoot,
      outputStyleEntry.slice(0, -styleEntrySuffix.length),
    );
    return `${context.packageName}/${toPosixPath(sourceModuleDir)}.css`;
  }

  private toDevExternalStyleSpecifier(
    specifier: string,
    cache: ModuleStyleGraphRequestCache,
  ) {
    const parsed = parsePackageStyleSpecifier(specifier);
    if (!parsed) return specifier;

    if (this.isWorkspacePackageName(parsed.packageName, cache)) {
      if (parsed.stylePath === STYLE_ENTRY) {
        return `${parsed.packageName}/${EXTERNAL_ENTRY}`;
      }
      if (
        parsed.stylePath ===
        [this.config.output.styleDir, this.config.output.indexStyleFile].join(
          '/',
        )
      ) {
        return `${parsed.packageName}/${EXTERNAL_ENTRY}`;
      }
    }
    return specifier;
  }

  private parsePackageStyleIdInRequest(
    id: string,
    cache: ModuleStyleGraphRequestCache,
  ) {
    return parsePackageStyleId(id, cache.getWorkspacePackageNames());
  }

  private isWorkspacePackageName(
    packageName: string,
    cache: ModuleStyleGraphRequestCache,
  ) {
    return cache.isWorkspacePackageName(packageName);
  }

  private createRequestCache() {
    return new ModuleStyleGraphRequestCache({
      workspaceRoot: this.workspaceRoot,
      packagesDir: this.packagesDir,
      config: this.config,
      loadAukletConfig: this.loadAukletConfig,
    });
  }
}

export function parsePackageStyleId(id: string, packageNames: Array<string>) {
  if (!id.endsWith('.css')) {
    return null;
  }

  const packageName = [...packageNames]
    .sort((left, right) => right.length - left.length)
    .find((name) => id.startsWith(`${name}/`));
  if (!packageName) return null;

  return {
    packageName,
    stylePath: id.slice(packageName.length + 1),
  } satisfies PackageStyleId;
}
