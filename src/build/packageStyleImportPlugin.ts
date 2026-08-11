import path from 'node:path';
import { isPlainStyleSpecifier } from '#auklet/css/core/resolvers/externalPackageStyle';
import {
  loadPackageStyleCss,
  resolvePlainPackageStyleFile,
} from '#auklet/css/core/packageStyleSource';
import {
  toCssModuleOutputFileName,
  toCssModuleOutputImportPath,
} from '#auklet/css/modules/cssModuleOutputPaths';
import { normalizeFileKey } from '#auklet/utils';

const STYLE_JS_SUFFIX = '.js';

const isPackageStyleJsId = (id: string) =>
  /\.(?:css|less)\.js$/i.test(id) && !/\.module\.(?:css|less)\.js$/i.test(id);

const toPackageStyleJsId = (file: string) =>
  `${path.resolve(file)}${STYLE_JS_SUFFIX}`;

const fromPackageStyleJsId = (id: string) => {
  if (!isPackageStyleJsId(id)) return null;
  const styleFile = id.slice(0, -STYLE_JS_SUFFIX.length);
  return isPlainStyleSpecifier(styleFile) ? path.resolve(styleFile) : null;
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

export type PackageStyleImportPluginOptions = {
  packageRoot: string;
  sourceRoot: string;
};

export function createPackageStyleImportPlugin(
  options: PackageStyleImportPluginOptions,
) {
  const packageRoot = path.resolve(options.packageRoot);
  const sourceRoot = path.resolve(options.sourceRoot);
  const cssByModuleId = new Map<string, string>();
  const cssSourceByFile = new Map<string, string>();
  const emitted = new Set<string>();

  const toOutputCssFileName = (file: string) =>
    toCssModuleOutputFileName({
      file,
      sourceRoot,
      consumerPackageRoot: packageRoot,
    });

  const loadCss = async (file: string) => {
    const key = normalizeFileKey(file);
    const cached = cssSourceByFile.get(key);
    if (cached != null) return cached;
    const css = await loadPackageStyleCss(file);
    cssSourceByFile.set(key, css);
    return css;
  };

  return {
    name: 'auklet-package-style-import',
    buildStart() {
      cssByModuleId.clear();
      cssSourceByFile.clear();
      emitted.clear();
    },
    resolveId: {
      order: 'pre' as const,
      handler(source: string) {
        if (fromPackageStyleJsId(source)) return source;
        const file = resolvePlainPackageStyleFile(source, packageRoot);
        if (!file) return null;
        return toPackageStyleJsId(file);
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
      const file = fromPackageStyleJsId(id);
      if (!file) return null;

      const css = await loadCss(file);
      const cssFileName = toOutputCssFileName(file);
      cssByModuleId.set(id, cssFileName);
      if (!emitted.has(cssFileName)) {
        emitted.add(cssFileName);
        this.emitFile({
          type: 'asset',
          fileName: cssFileName,
          source: css,
        });
      }

      return {
        code: 'export {};\n',
        moduleSideEffects: true,
      };
    },
    renderChunk(
      code: string,
      chunk: { fileName: string; moduleIds: Array<string> },
      outputOptions?: { format?: string },
    ) {
      const sideEffects: Array<string> = [];
      for (const moduleId of chunk.moduleIds) {
        const cssFileName = cssByModuleId.get(moduleId);
        if (!cssFileName) continue;
        sideEffects.push(
          createCssSideEffectCode(
            toCssModuleOutputImportPath(chunk.fileName, cssFileName),
            outputOptions?.format,
            code,
          ),
        );
      }
      if (!sideEffects.length) return null;
      return {
        code: `${Array.from(new Set(sideEffects)).join('\n')}\n${code}`,
        map: null,
      };
    },
  };
}
