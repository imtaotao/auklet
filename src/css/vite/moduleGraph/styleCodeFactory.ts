import path from 'node:path';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type {
  ModuleStyleGraphRequestCache,
  PackageStyleContext,
} from '#auklet/css/vite/moduleGraph/requestCache';
import { mergeLoadResults } from '#auklet/css/vite/moduleGraph/loadResult';
import { parsePackageStyleId } from '#auklet/css/vite/moduleGraph/styleId';
import { toDevDependencyImportSpecifier } from '#auklet/css/vite/moduleGraph/devDependency';
import type {
  PackageStyleId,
  PackageStyleLoadResult,
} from '#auklet/css/vite/moduleGraph/types';
import {
  EXTERNAL_ENTRY,
  MODULE_ENTRY,
  STYLE_ENTRY,
  THEMES_ENTRY_PREFIX,
} from '#auklet/css/constants';
import {
  createModuleStyleEntryPlan,
  createExternalEntryParts,
  createStyleEntryParts,
  createThemeEntryParts,
} from '#auklet/css/core/style/entries';
import {
  createDevExternalStyleSpecifier,
  createDevModuleStyleSpecifier,
  createImportCode,
  removeStyleExtension,
} from '#auklet/css/core/style/specifier';

// 生成 Vite/dev 虚拟 CSS；production writer 共享入口语义，但写入真实文件。
export class StyleCodeFactory {
  constructor(private readonly config: ModuleStyleBuildConfig) {}

  async createPackageStyleCode(
    parsed: PackageStyleId,
    cache: ModuleStyleGraphRequestCache,
  ) {
    return cache.getLoadResult(parsed, () =>
      this.createUncachedPackageStyleCode(parsed, cache),
    );
  }

  private async createUncachedPackageStyleCode(
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

    const cachedResult = cache.readPersistentLoadResult(parsed, context);
    if (cachedResult) return cachedResult;

    let result: PackageStyleLoadResult;
    if (parsed.stylePath === STYLE_ENTRY) {
      result = await this.createStyleCode(context, cache);
    } else if (parsed.stylePath === EXTERNAL_ENTRY) {
      result = await this.createExternalStyleCode(context, cache);
    } else if (parsed.stylePath === MODULE_ENTRY) {
      result = this.createModuleStyleCode(context);
    } else if (parsed.stylePath.startsWith(THEMES_ENTRY_PREFIX)) {
      result = await this.createThemeStyleCode(context, cache, [
        removeStyleExtension(
          parsed.stylePath.slice(THEMES_ENTRY_PREFIX.length),
        ),
      ]);
    } else {
      result = await this.createSourceModuleStyleCode(
        context,
        cache,
        parsed.stylePath,
      );
    }
    return cache.writePersistentLoadResult(parsed, context, result);
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
    const watchFiles: Array<string> = [...context.configPaths];

    for (const specifier of specifiers) {
      const outputSpecifier = mapSpecifier(specifier);
      const parsed = this.parsePackageStyleIdInRequest(outputSpecifier, cache);
      if (parsed) {
        const result = await this.createPackageStyleCode(parsed, cache);
        results.push(this.withDependencyPackage(result, parsed.packageName));
        continue;
      }
      const resolvedSpecifier = toDevDependencyImportSpecifier(
        context,
        outputSpecifier,
      );
      imports.push(resolvedSpecifier.specifier);
      if (resolvedSpecifier.watchFile) {
        watchFiles.push(resolvedSpecifier.watchFile);
      }
    }

    return mergeLoadResults(
      {
        code: createImportCode(imports),
        watchFiles,
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
      results.push(
        await this.createDependencyStyleCode(
          context,
          cache,
          part.specifiers,
          (specifier) => this.toDevExternalStyleSpecifier(specifier, cache),
        ),
      );
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
    const watchFiles = [...context.configPaths, ...themeFiles.values()];
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
      watchFiles: [...context.configPaths, ...styleFiles],
    };
  }

  private async createSourceModuleStyleCode(
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    stylePath: string,
  ) {
    const sourceModuleDir = removeStyleExtension(stylePath);
    const { styleFiles, sourceFiles } = context.packageContext;
    const entry = createModuleStyleEntryPlan(
      context.packageContext,
      sourceModuleDir,
    );
    const sourceStyleDir = path.join(
      context.sourceRoot,
      sourceModuleDir,
      this.config.output.styleDir,
    );
    const moduleStyleResults: Array<PackageStyleLoadResult> = [];
    const moduleStyleSpecifiers: Array<string> = [];
    const moduleStyleWatchFiles: Array<string> = [];

    for (const specifier of entry.moduleStyleImports) {
      const result = this.toDevModuleImportSpecifier(
        specifier,
        context,
        cache,
        sourceStyleDir,
      );
      const parsed = this.parsePackageStyleIdInRequest(result, cache);
      if (parsed) {
        const loadResult = await this.createPackageStyleCode(parsed, cache);
        moduleStyleResults.push(
          this.withDependencyPackage(loadResult, parsed.packageName),
        );
        continue;
      }
      const resolvedSpecifier = toDevDependencyImportSpecifier(context, result);
      moduleStyleSpecifiers.push(resolvedSpecifier.specifier);
      if (resolvedSpecifier.watchFile) {
        moduleStyleWatchFiles.push(resolvedSpecifier.watchFile);
      }
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
        ...context.configPaths,
        ...styleFiles,
        ...moduleStyleWatchFiles,
        ...sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file)),
      ],
    });
  }

  private toDevModuleImportSpecifier(
    specifier: string,
    context: PackageStyleContext,
    cache: ModuleStyleGraphRequestCache,
    sourceStyleDir: string,
  ) {
    return createDevModuleStyleSpecifier(specifier, {
      sourceStyleDir,
      sourceRoot: context.sourceRoot,
      packageName: context.packageName,
      styleDir: this.config.output.styleDir,
      indexStyleFile: this.config.output.indexStyleFile,
      mapExternalSpecifier: (externalSpecifier) =>
        this.toDevExternalStyleSpecifier(externalSpecifier, cache),
    });
  }

  private toDevExternalStyleSpecifier(
    specifier: string,
    cache: ModuleStyleGraphRequestCache,
  ) {
    return createDevExternalStyleSpecifier(specifier, {
      isKnownPackageName: (packageName) =>
        cache.isKnownPackageName(packageName),
      styleDir: this.config.output.styleDir,
      indexStyleFile: this.config.output.indexStyleFile,
      externalStyleFile: EXTERNAL_ENTRY,
    });
  }

  private parsePackageStyleIdInRequest(
    id: string,
    cache: ModuleStyleGraphRequestCache,
  ) {
    return parsePackageStyleId(id, cache.getPackageNames());
  }

  private withDependencyPackage(
    result: PackageStyleLoadResult,
    packageName: string,
  ) {
    return {
      ...result,
      dependencyPackages: Array.from(
        new Set([packageName, ...(result.dependencyPackages ?? [])]),
      ),
    };
  }
}
