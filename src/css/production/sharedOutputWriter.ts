import fs from 'node:fs';
import path from 'node:path';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import {
  createSharedOutputEntries,
  sharedOutputRequiresModules,
  type SharedOutputEntry,
} from '#auklet/css/core/style/sharedOutput';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { compileCssModule } from '#auklet/css/modules/compileCssModule';
import {
  rewriteCssModuleOutputImportSpecifiers,
  toCssModuleOutputFileName,
  toCssModuleOutputImportPath,
} from '#auklet/css/modules/cssModuleOutputPaths';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export type SharedStyleOutputWriterOptions = {
  config?: ModuleStyleBuildConfig;
  context: ResolvedModuleStyleBuildContext;
  packageContext: StylePackageContext;
};

// Match tsdown module output: dist/es → ESM, dist/lib → CJS (same as
// createCssModulesPlugin renderChunk side-effect style).
const isCjsOutputFormat = (format: string) =>
  format === 'lib' || format === 'cjs' || format === 'commonjs';

const createLocalsShimCode = (
  cssImportPath: string,
  locals: Record<string, string>,
  format: string,
) => {
  const localsJson = JSON.stringify(locals);
  if (isCjsOutputFormat(format)) {
    return `require(${JSON.stringify(cssImportPath)});\nexports.default = ${localsJson};\n`;
  }
  return `import ${JSON.stringify(cssImportPath)};\nexport default ${localsJson};\n`;
};

const writeTextFile = (file: string, source: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
};

// Emits styles.shared.output: Modules → scoped.css + shim; plain css/less →
// copy as-is under dist/es|lib (Less is not compiled).
export class SharedStyleOutputWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly context: ResolvedModuleStyleBuildContext;
  private readonly packageContext: StylePackageContext;

  constructor(options: SharedStyleOutputWriterOptions) {
    this.config = options.config ?? moduleStyleBuildConfig;
    this.context = options.context;
    this.packageContext = options.packageContext;
  }

  async write() {
    const patterns = this.packageContext.normalizedConfig.styles.shared.output;
    if (!patterns.length) return [];

    const sourceRoot = this.packageContext.sourceRoot;
    const packageRoot = this.context.packageRoot;
    if (
      sharedOutputRequiresModules({
        packageRoot,
        sourceRoot,
        patterns,
      }) &&
      !this.packageContext.normalizedConfig.modules
    ) {
      throw new Error(
        '[css] styles.shared.output CSS Modules entries require modules: true.',
      );
    }

    const entries = createSharedOutputEntries({
      packageRoot,
      sourceRoot,
      outputDir: this.context.outputDir,
      outputFormats: this.config.output.outputFormats,
      patterns,
    });
    if (!entries.length) return [];

    const written: Array<string> = [];
    const emittedCss = new Set<string>();

    for (const entry of entries) {
      if (entry.kind === 'module') {
        written.push(
          ...(await this.writeModuleEntry(
            entry,
            packageRoot,
            sourceRoot,
            emittedCss,
          )),
        );
        continue;
      }

      written.push(...this.writePlainEntry(entry, packageRoot));
    }

    return written;
  }

  private writePlainEntry(entry: SharedOutputEntry, packageRoot: string) {
    const source = fs.readFileSync(entry.sourceFile, 'utf8');
    const written: Array<string> = [];
    for (const format of this.config.output.outputFormats) {
      const outFile = path.join(
        packageRoot,
        this.context.outputDir,
        format,
        entry.assetRelative,
      );
      writeTextFile(outFile, source);
      written.push(outFile);
    }
    return written;
  }

  private async writeModuleEntry(
    entry: SharedOutputEntry,
    packageRoot: string,
    sourceRoot: string,
    emittedCss: Set<string>,
  ) {
    const result = await compileCssModule({
      file: entry.sourceFile,
      packageRoot,
      sourceRoot,
    });
    const written: Array<string> = [];
    const jsRelative = entry.jsRelative;
    if (!jsRelative) {
      throw new Error(
        `[css] shared.output module entry is missing jsRelative: ${entry.sourceRelative}`,
      );
    }

    for (const format of this.config.output.outputFormats) {
      const formatRoot = path.join(packageRoot, this.context.outputDir, format);
      const cssFile = path.join(formatRoot, entry.assetRelative);
      const jsFile = path.join(formatRoot, jsRelative);

      for (const asset of result.styleAssets) {
        const assetRelative = toCssModuleOutputFileName({
          file: asset.file,
          sourceRoot,
          consumerPackageRoot: packageRoot,
        });
        const assetFile = path.join(formatRoot, assetRelative);
        const assetKey = `${format}:${assetRelative}`;
        if (!emittedCss.has(assetKey)) {
          emittedCss.add(assetKey);
          writeTextFile(
            assetFile,
            rewriteCssModuleOutputImportSpecifiers({
              css: asset.css,
              importerFile: asset.file,
              styleAssets: result.styleAssets,
              sourceRoot,
              consumerPackageRoot: packageRoot,
            }),
          );
          written.push(assetFile);
        }
      }

      const cssKey = `${format}:${entry.assetRelative}`;
      if (!emittedCss.has(cssKey)) {
        emittedCss.add(cssKey);
        writeTextFile(
          cssFile,
          rewriteCssModuleOutputImportSpecifiers({
            css: result.css,
            importerFile: entry.sourceFile,
            importerOutputFileName: entry.assetRelative,
            styleAssets: result.styleAssets,
            sourceRoot,
            consumerPackageRoot: packageRoot,
          }),
        );
        written.push(cssFile);
      }

      const cssImportPath = toCssModuleOutputImportPath(
        jsRelative,
        entry.assetRelative,
      );
      writeTextFile(
        jsFile,
        createLocalsShimCode(cssImportPath, result.locals, format),
      );
      written.push(jsFile);
    }

    return written;
  }
}
