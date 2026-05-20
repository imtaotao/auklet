import path from 'node:path';
import { normalizeAukletConfig } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { ModuleStyleOutputWriter } from '#auklet/css/production/moduleOutputWriter';
import { PackageStyleEntryWriter } from '#auklet/css/production/packageEntryWriter';
import type {
  AukletLogger,
  ModuleStyleBuildConfig,
  ModuleStyleBuildContext,
  ModuleStyleBuildOptions,
  NormalizedAukletConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';
import { toPosixPath } from '#auklet/utils';

export class ModuleStyleBuilder {
  private readonly context: ModuleStyleBuildContext & { packageRoot: string };
  private readonly logger?: AukletLogger;

  constructor(
    context: ModuleStyleBuildContext = {},
    private readonly config: ModuleStyleBuildConfig = moduleStyleBuildConfig,
  ) {
    this.context = {
      packageRoot: process.cwd(),
      source: context.source,
      output: context.output,
      ...context,
    };
    this.logger = context.logger;
  }

  async build(options: ModuleStyleBuildOptions = {}) {
    const rawConfig = options.aukletConfig ?? this.context.aukletConfig ?? {};
    const normalizedConfig = normalizeAukletConfig(rawConfig);
    const logger = options.logger ?? this.logger;
    const context = this.createBuildContext(normalizedConfig);
    const packageContext = this.createPackageContext(context, normalizedConfig);
    const writerOptions = {
      config: this.config,
      context,
      packageContext,
    };
    const packageWriter = new PackageStyleEntryWriter(writerOptions);
    const packageOutput = packageWriter.write();
    const outputs = packageOutput ? [packageOutput] : [];

    logger?.log?.(`[auklet:css] build ${path.basename(context.packageRoot)}`);

    if (normalizedConfig.modules) {
      outputs.push(...new ModuleStyleOutputWriter(writerOptions).write());
    }

    this.logOutputs(context, packageContext.styleFiles, outputs, logger);
  }

  private logOutputs(
    context: ResolvedModuleStyleBuildContext,
    styleFiles: Array<string>,
    outputs: Array<string>,
    logger?: AukletLogger,
  ) {
    logger?.log?.(
      `[auklet:css] ${styleFiles.length} source style file(s), ${outputs.length} output entry file(s)`,
    );
    for (const output of outputs) {
      logger?.log?.(
        `[auklet:css] + ${toPosixPath(
          path.relative(context.packageRoot, output),
        )}`,
      );
    }
  }

  private createBuildContext(config: NormalizedAukletConfig) {
    return {
      packageRoot: this.context.packageRoot,
      sourceDir: this.context.source ?? config.source,
      outputDir: this.context.output ?? config.output,
    };
  }

  private createPackageContext(
    context: ResolvedModuleStyleBuildContext,
    normalizedConfig: NormalizedAukletConfig,
  ) {
    return new StylePackageContext({
      config: this.config,
      context,
      normalizedConfig,
    });
  }
}
