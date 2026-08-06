import path from 'node:path';
import {
  compileCssModule,
  type CssModuleResult,
} from '#auklet/css/modules/compileCssModule';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import {
  resolveCssModuleImport,
  stripCssModuleQuery,
} from '#auklet/css/modules/resolveCssModuleImport';
import { normalizeFileKey, toPosixPath } from '#auklet/utils';

// Synthetic module ids end in `.module.css.js` / `.module.less.js` so tsdown's
// CssGuardPlugin (which matches /\.(?:css|less)$/) does not intercept them.
const MODULE_JS_SUFFIX = '.js';

const isModuleJsId = (id: string) =>
  /\.module\.(?:css|less)\.js$/i.test(stripCssModuleQuery(id));

const toModuleJsId = (file: string, sourceRoot: string) => {
  const resolved = path.resolve(file);
  const relative = path.relative(sourceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.join(
      path.dirname(resolved),
      `${path.basename(resolved)}${MODULE_JS_SUFFIX}`,
    );
  }
  return path.join(sourceRoot, `${toPosixPath(relative)}${MODULE_JS_SUFFIX}`);
};

const fromModuleJsId = (id: string) => {
  const cleanId = stripCssModuleQuery(id);
  if (!isModuleJsId(cleanId)) return null;

  const moduleFile = cleanId.slice(0, -MODULE_JS_SUFFIX.length);
  return isCssModuleFile(moduleFile) ? moduleFile : null;
};

const resolveCssModuleFile = (source: string, importer?: string) => {
  return resolveCssModuleImport({
    source,
    importer,
    parseModuleFileFromId: fromModuleJsId,
  });
};

export type CssModulesPluginOptions = {
  sourceRoot: string;
};

const toOutputCssFileName = (file: string, sourceRoot: string) => {
  const relative = path.relative(sourceRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(file).replace(/\.less$/i, '.css');
  }
  return toPosixPath(relative.replace(/\.less$/i, '.css'));
};

const toCssImportPath = (chunkFileName: string, cssFileName: string) => {
  const relative = toPosixPath(
    path.posix.relative(path.posix.dirname(chunkFileName), cssFileName),
  );
  if (!relative || relative === '.') {
    return `./${path.posix.basename(cssFileName)}`;
  }
  return relative.startsWith('.') ? relative : `./${relative}`;
};

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

export function createCssModulesPlugin(options: CssModulesPluginOptions) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const cache = new Map<string, CssModuleResult>();
  const cssOutputByEntryId = new Map<string, string>();
  const cssOutputByModuleFile = new Map<string, string>();
  const compiledByModuleFile = new Map<string, CssModuleResult>();
  const emittedStyleAssets = new Set<string>();

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
    const result = await compileCssModule({ file, sourceRoot });
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
    const cssFileName = toOutputCssFileName(file, sourceRoot);

    for (const asset of result.styleAssets) {
      const assetFileName = toOutputCssFileName(asset.file, sourceRoot);
      if (emittedStyleAssets.has(assetFileName)) continue;
      emittedStyleAssets.add(assetFileName);
      emitFile({
        type: 'asset',
        fileName: assetFileName,
        source: asset.css,
      });
    }

    if (emittedStyleAssets.has(cssFileName)) return;
    emittedStyleAssets.add(cssFileName);
    emitFile({
      type: 'asset',
      fileName: cssFileName,
      source: result.css,
    });
  };

  return {
    name: 'auklet-css-modules',
    buildStart() {
      cache.clear();
      emittedStyleAssets.clear();
    },
    resolveId: {
      order: 'pre' as const,
      async handler(source: string, importer?: string) {
        if (fromModuleJsId(source)) return source;

        const file = resolveCssModuleFile(source, importer);
        if (!file) return null;
        return toModuleJsId(file, sourceRoot);
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
      const cssFileName = toOutputCssFileName(file, sourceRoot);
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

          const cssFileName = toOutputCssFileName(moduleFile, sourceRoot);
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
