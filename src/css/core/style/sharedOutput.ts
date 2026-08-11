import fs from 'node:fs';
import path from 'node:path';
import { findPathInExports, type Exports } from 'conditional-export';
import { resolveSharedStylePatterns } from '#auklet/css/core/style/shared';
import { isCssModuleFile } from '#auklet/css/modules/isCssModuleFile';
import { toPosixPath } from '#auklet/utils';
import type { NormalizedAukletConfig } from '#auklet/types';

const MODULE_JS_SUFFIX = '.js';
// Published shared.output CSS must not keep a `*.module.css` name: Vite /
// webpack treat that pattern as CSS Modules and would re-hash class names while
// the JS shim still exports the producer locals.
export const SHARED_OUTPUT_SCOPED_CSS_SUFFIX = '.scoped.css';

const STYLE_EXPORT_CONDITIONS = [
  'less',
  'source',
  'style',
  'import',
  'default',
];

export type SharedOutputEntry = {
  sourceFile: string;
  sourceRelative: string;
  exportSubpath: string;
  cssRelative: string;
  jsRelative: string;
  cssFiles: Array<string>;
  jsFiles: Array<string>;
};

export type SharedOutputExportCheck = {
  exportSubpath: string;
  exportTarget: string | null;
  expectedJsRelative: string;
  ok: boolean;
  reason?: string;
};

export function listSharedOutputModuleFiles(options: {
  packageRoot: string;
  sourceRoot: string;
  patterns: Array<string>;
}) {
  const matched = resolveSharedStylePatterns(options);
  const modules = matched.filter((file) => isCssModuleFile(file));
  const nonModules = matched.filter((file) => !isCssModuleFile(file));
  if (nonModules.length) {
    throw new Error(
      `[css] styles.shared.output must match CSS Modules files only (*.module.css|*.module.less): ${nonModules
        .slice(0, 3)
        .map((file) => toPosixPath(path.relative(options.packageRoot, file)))
        .join(', ')}`,
    );
  }
  return modules;
}

export function toSharedOutputCssRelative(sourceRelative: string) {
  return toPosixPath(
    sourceRelative.replace(
      /\.module\.(css|less)$/i,
      SHARED_OUTPUT_SCOPED_CSS_SUFFIX,
    ),
  );
}

export function toSharedOutputJsRelative(sourceRelative: string) {
  return `${toPosixPath(sourceRelative)}${MODULE_JS_SUFFIX}`;
}

export function isSharedOutputScopedCssFile(file: string) {
  return file.toLowerCase().endsWith(SHARED_OUTPUT_SCOPED_CSS_SUFFIX);
}

export function createSharedOutputEntries(options: {
  packageRoot: string;
  sourceRoot: string;
  outputDir: string;
  outputFormats: Array<string>;
  patterns: Array<string>;
}) {
  const modules = listSharedOutputModuleFiles(options);
  return modules.map((sourceFile) => {
    const sourceRelative = toPosixPath(
      path.relative(options.sourceRoot, sourceFile),
    );
    const cssRelative = toSharedOutputCssRelative(sourceRelative);
    const jsRelative = toSharedOutputJsRelative(sourceRelative);
    return {
      sourceFile,
      sourceRelative,
      exportSubpath: `./${sourceRelative}`,
      cssRelative,
      jsRelative,
      cssFiles: options.outputFormats.map((format) =>
        toPosixPath(path.join(options.outputDir, format, cssRelative)),
      ),
      jsFiles: options.outputFormats.map((format) =>
        toPosixPath(path.join(options.outputDir, format, jsRelative)),
      ),
    } satisfies SharedOutputEntry;
  });
}

export function createSharedOutputEntriesFromConfig(options: {
  packageRoot: string;
  normalizedConfig: NormalizedAukletConfig;
  outputFormats: Array<string>;
}) {
  const sourceRoot = path.join(
    options.packageRoot,
    options.normalizedConfig.source,
  );
  return createSharedOutputEntries({
    packageRoot: options.packageRoot,
    sourceRoot,
    outputDir: options.normalizedConfig.output,
    outputFormats: options.outputFormats,
    patterns: options.normalizedConfig.styles.shared.output,
  });
}

export function checkSharedOutputExports(options: {
  packageRoot: string;
  entries: Array<SharedOutputEntry>;
}) {
  if (!options.entries.length) return [] as Array<SharedOutputExportCheck>;

  const packageJsonFile = path.join(options.packageRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')) as {
    exports?: Exports;
  };
  if (!packageJson.exports) {
    return options.entries.map((entry) => ({
      exportSubpath: entry.exportSubpath,
      exportTarget: null,
      expectedJsRelative: entry.jsFiles[0] ?? entry.jsRelative,
      ok: false,
      reason: 'package.json#exports is missing',
    }));
  }

  return options.entries.map((entry) => {
    const expectedJsRelative = entry.jsFiles[0] ?? entry.jsRelative;
    const target = (() => {
      try {
        return findPathInExports(
          entry.exportSubpath,
          packageJson.exports!,
          STYLE_EXPORT_CONDITIONS,
        );
      } catch {
        return null;
      }
    })();
    if (!target) {
      return {
        exportSubpath: entry.exportSubpath,
        exportTarget: null,
        expectedJsRelative,
        ok: false,
        reason: 'subpath is not exported',
      };
    }
    const normalizedTarget = toPosixPath(target.replace(/^\.\//, ''));
    // Only published dist/es|lib shims — bare jsRelative (e.g. shared/foo.js)
    // is not an accepted export target.
    const accepted = new Set(entry.jsFiles);
    if (!accepted.has(normalizedTarget)) {
      return {
        exportSubpath: entry.exportSubpath,
        exportTarget: target,
        expectedJsRelative,
        ok: false,
        reason: `export target should be ./${expectedJsRelative}`,
      };
    }
    return {
      exportSubpath: entry.exportSubpath,
      exportTarget: target,
      expectedJsRelative,
      ok: true,
    };
  });
}

export function checkSharedOutputDistFiles(options: {
  packageRoot: string;
  entries: Array<SharedOutputEntry>;
}) {
  return options.entries.flatMap((entry) => {
    const files = [...entry.cssFiles, ...entry.jsFiles];
    return files.map((relative) => {
      const absolute = path.join(options.packageRoot, relative);
      return {
        entry: entry.exportSubpath,
        file: relative,
        exists: fs.existsSync(absolute),
      };
    });
  });
}
