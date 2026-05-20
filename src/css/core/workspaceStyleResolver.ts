import path from 'node:path';
import { createRequire } from 'node:module';
import { NODE_MODULES_DIR, STYLE_ENTRY } from '#auklet/css/constants';
import { POSIX_SEPARATOR } from '#auklet/utils';
import { parsePackageStyleSpecifier } from '#auklet/css/core/style/specifier';
import type {
  ModuleStyleBuildConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export class WorkspaceStyleResolver {
  private readonly require: ReturnType<typeof createRequire>;

  constructor(
    private readonly config: ModuleStyleBuildConfig,
    private readonly context: ResolvedModuleStyleBuildContext,
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
    const parsed = parsePackageStyleSpecifier(specifier);
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
    const parsed = parsePackageStyleSpecifier(specifier);
    if (!parsed) return specifier;
    const { packageName, stylePath } = parsed;
    const currentOutputFormat = path.basename(outRoot);
    const outputFormat = this.getStylePathOutputFormat(stylePath);

    if (stylePath === STYLE_ENTRY) {
      return [packageName, this.config.output.externalStyleFile].join(
        POSIX_SEPARATOR,
      );
    }

    if (
      outputFormat &&
      outputFormat.path ===
        [this.config.output.styleDir, this.config.output.indexStyleFile].join(
          POSIX_SEPARATOR,
        )
    ) {
      return [
        packageName,
        currentOutputFormat,
        this.config.output.styleDir,
        this.config.output.externalStyleFile,
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
}
