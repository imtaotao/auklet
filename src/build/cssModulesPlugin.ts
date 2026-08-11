import path from 'node:path';
import { isExternalPackageSpecifier } from '#auklet/css/core/resolvers/externalLess';
import {
  findPackageRootForFile,
  isCssModuleSpecifier,
  resolveExternalPackageStyleImport,
  resolveStyleSourceRootForFile,
} from '#auklet/css/core/resolvers/externalPackageStyle';
import {
  listSharedOutputModuleFiles,
  toSharedOutputCssRelative,
} from '#auklet/css/core/style/sharedOutput';
import {
  compileCssModule,
  type CssModuleResult,
} from '#auklet/css/modules/compileCssModule';
import {
  rewriteCssModuleOutputImportSpecifiers,
  toCssModuleOutputFileName,
  toCssModuleOutputImportPath,
} from '#auklet/css/modules/cssModuleOutputPaths';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  resolveCssModuleImport,
  stripCssModuleQuery,
} from '#auklet/css/modules/resolveCssModuleImport';
import { isInsideRoot, normalizeFileKey, toPosixPath } from '#auklet/utils';

// Synthetic module ids end in `.module.css.js` / `.module.less.js` so tsdown's
// CssGuardPlugin (which matches /\.(?:css|less)$/) does not intercept them.
const MODULE_JS_SUFFIX = '.js';

const isModuleJsId = (id: string) =>
  /\.module\.(?:css|less)\.js$/i.test(stripCssModuleQuery(id));

export type CssModulesPluginOptions = {
  packageRoot?: string;
  sourceRoot: string;
  sharedOutputPatterns?: Array<string>;
};

const toOutputCssFileName = (
  file: string,
  sourceRoot: string,
  consumerPackageRoot: string,
) =>
  toCssModuleOutputFileName({
    file,
    sourceRoot,
    consumerPackageRoot,
  });

const toCssImportPath = toCssModuleOutputImportPath;

const isCjsOutputFormat = (format: string | undefined, code: string) => {
  if (format === 'cjs' || format === 'commonjs') return true;
  if (format === 'es' || format === 'esm' || format === 'module') return false;
  return (
    /^(\s*"use strict";?\s*)?Object\.defineProperty\(exports/m.test(code) ||
    /\bexports\.[a-zA-Z_$]/.test(code) ||
    /\bmodule\.exports\b/.test(code)
  );
};

const createCssSideEffectCode = (
  importPath: string,
  format: string | undefined,
  code: string,
) => {
  if (isCjsOutputFormat(format, code)) {
    return `require(${JSON.stringify(importPath)});`;
  }
  return `import ${JSON.stringify(importPath)};`;
};

const resolveCompileRoots = (
  file: string,
  consumerPackageRoot: string,
  consumerSourceRoot: string,
) => {
  if (isInsideRoot(file, consumerSourceRoot)) {
    return {
      packageRoot: consumerPackageRoot,
      sourceRoot: consumerSourceRoot,
    };
  }
  const providerPackageRoot = findPackageRootForFile(file);
  const sourceRoot = resolveStyleSourceRootForFile({
    file,
    packageRoot: providerPackageRoot,
  });
  return {
    packageRoot: providerPackageRoot ?? consumerPackageRoot,
    sourceRoot: sourceRoot ?? consumerSourceRoot,
  };
};

const rewriteCssImportSpecifiersForOutput = (
  css: string,
  importerFile: string,
  styleAssets: CssModuleResult['styleAssets'],
  sourceRoot: string,
  consumerPackageRoot: string,
  importerOutputFileName?: string,
) =>
  rewriteCssModuleOutputImportSpecifiers({
    css,
    importerFile,
    importerOutputFileName,
    styleAssets,
    sourceRoot,
    consumerPackageRoot,
  });

export function createCssModulesPlugin(options: CssModulesPluginOptions) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const packageRoot = path.resolve(
    options.packageRoot ?? path.dirname(sourceRoot),
  );
  const sharedOutputKeys = new Set(
    listSharedOutputModuleFiles({
      packageRoot,
      sourceRoot,
      patterns: options.sharedOutputPatterns ?? [],
    }).map((file) => normalizeFileKey(file)),
  );
  const cache = new Map<string, CssModuleResult>();
  const cssOutputByEntryId = new Map<string, string>();
  const cssOutputByModuleFile = new Map<string, string>();
  const compiledByModuleFile = new Map<string, CssModuleResult>();
  const emittedStyleAssets = new Set<string>();
  const moduleFileByJsId = new Map<string, string>();

  const toEntryCssOutputFileName = (file: string) => {
    if (sharedOutputKeys.has(normalizeFileKey(file))) {
      const sourceRelative = toPosixPath(path.relative(sourceRoot, file));
      if (
        !sourceRelative.startsWith('..') &&
        !path.isAbsolute(sourceRelative)
      ) {
        return toSharedOutputCssRelative(sourceRelative);
      }
    }
    return toOutputCssFileName(file, sourceRoot, packageRoot);
  };

  const toModuleJsId = (file: string) => {
    const resolved = path.resolve(file);
    const relative = path.relative(sourceRoot, resolved);
    const id = (() => {
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return path.join(
          sourceRoot,
          `${toPosixPath(relative)}${MODULE_JS_SUFFIX}`,
        );
      }
      if (isInsideRoot(resolved, packageRoot)) {
        return path.join(
          path.dirname(resolved),
          `${path.basename(resolved)}${MODULE_JS_SUFFIX}`,
        );
      }
      return path.join(
        sourceRoot,
        `${toOutputCssFileName(resolved, sourceRoot, packageRoot)}${MODULE_JS_SUFFIX}`,
      );
    })();
    moduleFileByJsId.set(normalizeFileKey(id), resolved);
    return id;
  };

  const fromModuleJsId = (id: string) => {
    const cleanId = stripCssModuleQuery(id);
    if (!isModuleJsId(cleanId)) return null;
    const mapped = moduleFileByJsId.get(normalizeFileKey(cleanId));
    if (mapped) return mapped;
    const moduleFile = cleanId.slice(0, -MODULE_JS_SUFFIX.length);
    return isCssModuleFile(moduleFile) ? path.resolve(moduleFile) : null;
  };

  const rememberCssOutput = (
    moduleId: string,
    file: string,
    cssFileName: string,
  ) => {
    cssOutputByEntryId.set(moduleId, cssFileName);
    cssOutputByModuleFile.set(normalizeFileKey(file), cssFileName);
  };

  const resolveCssOutput = (moduleId: string) => {
    const fromEntry = cssOutputByEntryId.get(moduleId);
    if (fromEntry) return fromEntry;

    const moduleFile = fromModuleJsId(moduleId);
    if (!moduleFile) return null;
    return cssOutputByModuleFile.get(normalizeFileKey(moduleFile)) ?? null;
  };

  const getResult = async (file: string) => {
    const key = normalizeFileKey(file);
    const cached = cache.get(key);
    if (cached) return cached;
    const roots = resolveCompileRoots(file, packageRoot, sourceRoot);
    const result = await compileCssModule({
      file,
      packageRoot: roots.packageRoot,
      sourceRoot: roots.sourceRoot,
    });
    cache.set(key, result);
    compiledByModuleFile.set(key, result);
    return result;
  };

  const emitModuleCssAssets = (
    emitFile: (asset: {
      type: 'asset';
      fileName: string;
      source: string;
    }) => void,
    file: string,
    result: CssModuleResult,
  ) => {
    const cssFileName = toEntryCssOutputFileName(file);

    for (const asset of result.styleAssets) {
      const assetFileName = toOutputCssFileName(
        asset.file,
        sourceRoot,
        packageRoot,
      );
      if (emittedStyleAssets.has(assetFileName)) continue;
      emittedStyleAssets.add(assetFileName);
      emitFile({
        type: 'asset',
        fileName: assetFileName,
        source: rewriteCssImportSpecifiersForOutput(
          asset.css,
          asset.file,
          result.styleAssets,
          sourceRoot,
          packageRoot,
        ),
      });
    }

    if (emittedStyleAssets.has(cssFileName)) return;
    emittedStyleAssets.add(cssFileName);
    emitFile({
      type: 'asset',
      fileName: cssFileName,
      source: rewriteCssImportSpecifiersForOutput(
        result.css,
        file,
        result.styleAssets,
        sourceRoot,
        packageRoot,
        cssFileName,
      ),
    });
  };

  return {
    name: 'auklet-css-modules',
    buildStart() {
      cache.clear();
      emittedStyleAssets.clear();
      moduleFileByJsId.clear();
    },
    resolveId: {
      order: 'pre' as const,
      async handler(source: string, importer?: string) {
        if (fromModuleJsId(source)) return source;

        if (
          isExternalPackageSpecifier(source) &&
          isCssModuleSpecifier(source)
        ) {
          try {
            const resolved = resolveExternalPackageStyleImport(
              source,
              packageRoot,
              {
                extensions: [
                  '.module.css',
                  '.module.less',
                  '.module.css.js',
                  '.module.less.js',
                ],
              },
            ).file;
            if (/\.module\.(?:css|less)\.js$/i.test(resolved)) {
              return { id: source, external: true };
            }
            return toModuleJsId(resolved);
          } catch {
            return null;
          }
        }

        const file = resolveCssModuleImport({
          source,
          importer,
          importerPackageRoot: packageRoot,
          parseModuleFileFromId: fromModuleJsId,
        });
        if (!file) return null;
        return toModuleJsId(file);
      },
    },
    async load(
      this: {
        emitFile: (asset: {
          type: 'asset';
          fileName: string;
          source: string;
        }) => void;
      },
      id: string,
    ) {
      const file = fromModuleJsId(id);
      if (!file) return null;

      const result = await getResult(file);
      const cssFileName = toEntryCssOutputFileName(file);
      rememberCssOutput(id, file, cssFileName);
      emitModuleCssAssets(this.emitFile.bind(this), file, result);

      return {
        code: `export default ${JSON.stringify(result.locals)};\n`,
        moduleSideEffects: true,
      };
    },
    generateBundle(
      this: {
        emitFile: (asset: {
          type: 'asset';
          fileName: string;
          source: string;
        }) => void;
      },
      _outputOptions: unknown,
      bundle: Record<
        string,
        { type: string; moduleIds?: Array<string> } | undefined
      >,
    ) {
      for (const item of Object.values(bundle)) {
        if (!item || item.type !== 'chunk' || !item.moduleIds) continue;

        for (const moduleId of item.moduleIds) {
          const moduleFile = fromModuleJsId(moduleId);
          if (!moduleFile) continue;

          const result = compiledByModuleFile.get(normalizeFileKey(moduleFile));
          if (!result) continue;

          const cssFileName = toEntryCssOutputFileName(moduleFile);
          rememberCssOutput(moduleId, moduleFile, cssFileName);
          emitModuleCssAssets(this.emitFile.bind(this), moduleFile, result);
        }
      }
    },
    renderChunk(
      code: string,
      chunk: { fileName: string; moduleIds: Array<string> },
      outputOptions?: { format?: string },
    ) {
      const sideEffects: Array<string> = [];

      for (const moduleId of chunk.moduleIds) {
        const cssFileName = resolveCssOutput(moduleId);
        if (!cssFileName) continue;

        const importPath = toCssImportPath(chunk.fileName, cssFileName);
        sideEffects.push(
          createCssSideEffectCode(importPath, outputOptions?.format, code),
        );
      }

      if (sideEffects.length === 0) return null;

      return {
        code: `${Array.from(new Set(sideEffects)).join('\n')}\n${code}`,
        map: null,
      };
    },
  };
}
