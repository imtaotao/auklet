import path from 'node:path';
import { createRequire } from 'node:module';
import { POSIX_SEPARATOR } from '#auklet/utils';
import type {
  ModuleCssBuildConfig,
  ResolvedModuleCssBuildContext,
} from '#auklet/types';

const NODE_MODULES_DIR = 'node_modules';
const PACKAGE_STYLE_FILE = 'style.css';

export class WorkspaceStyleResolver {
  private readonly require: ReturnType<typeof createRequire>;

  constructor(
    private readonly config: ModuleCssBuildConfig,
    private readonly context: ResolvedModuleCssBuildContext,
  ) {
    this.require = createRequire(
      path.join(this.context.packageRoot, 'package.json'),
    );
  }

  resolveStyleDependency(
    specifier: string,
    fromDir = this.context.packageRoot,
  ) {
    if (specifier.startsWith('.')) {
      return path.resolve(fromDir, specifier);
    }

    try {
      return this.require.resolve(specifier, {
        paths: [this.context.packageRoot],
      });
    } catch {
      return path.resolve(
        this.context.packageRoot,
        NODE_MODULES_DIR,
        specifier,
      );
    }
  }

  toOutputStyleSpecifier(specifier: string, outRoot: string) {
    const parsed = this.parsePackageStyleSpecifier(specifier);
    if (!parsed) return specifier;
    const { packageName, stylePath } = parsed;
    const currentOutputFormat = path.basename(outRoot);
    const outputFormat = this.getStylePathOutputFormat(stylePath);

    if (outputFormat) {
      return [packageName, currentOutputFormat, outputFormat.path].join(
        POSIX_SEPARATOR,
      );
    }

    return specifier;
  }

  toExternalStyleSpecifier(specifier: string, outRoot: string) {
    const parsed = this.parsePackageStyleSpecifier(specifier);
    if (!parsed) return specifier;
    const { packageName, stylePath } = parsed;
    const currentOutputFormat = path.basename(outRoot);
    const outputFormat = this.getStylePathOutputFormat(stylePath);

    if (stylePath === PACKAGE_STYLE_FILE) {
      return [packageName, this.config.output.externalCssFile].join(
        POSIX_SEPARATOR,
      );
    }

    if (
      outputFormat &&
      outputFormat.path ===
        [this.config.output.styleDir, this.config.output.indexCssFile].join(
          POSIX_SEPARATOR,
        )
    ) {
      return [
        packageName,
        currentOutputFormat,
        this.config.output.styleDir,
        this.config.output.externalCssFile,
      ].join(POSIX_SEPARATOR);
    }

    return specifier;
  }

  private getStylePathOutputFormat(stylePath: string) {
    for (const format of this.config.output.outputFormats) {
      const prefix = `${format}${POSIX_SEPARATOR}`;
      if (!stylePath.startsWith(prefix)) continue;
      return {
        format,
        path: stylePath.slice(prefix.length),
      };
    }
    return null;
  }

  private parsePackageStyleSpecifier(specifier: string) {
    if (specifier.startsWith('.')) return null;

    const parts = specifier.split(POSIX_SEPARATOR);
    const packageName = specifier.startsWith('@')
      ? `${parts.shift() ?? ''}${POSIX_SEPARATOR}${parts.shift() ?? ''}`
      : parts.shift() ?? '';

    if (!packageName) return null;
    return {
      packageName,
      stylePath: parts.join(POSIX_SEPARATOR),
    };
  }
}
