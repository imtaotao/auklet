import fs from 'node:fs';
import { normalizeAukletConfig } from '#auklet/config';
import { moduleStyleBuildConfig } from '#auklet/css/config';
import { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { ModuleStyleOutputWriter } from '#auklet/css/production/moduleOutputWriter';
import { PackageStyleEntryWriter } from '#auklet/css/production/packageEntryWriter';
import type {
  ModuleStyleBuildConfig,
  ModuleStyleBuildContext,
  ModuleStyleBuildOptions,
  NormalizedAukletConfig,
  ResolvedModuleStyleBuildContext,
} from '#auklet/types';

export class ModuleStyleBuilder {
  private readonly context: ModuleStyleBuildContext & { packageRoot: string };

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
  }

  async build(options: ModuleStyleBuildOptions = {}) {
    const rawConfig = options.aukletConfig ?? this.context.aukletConfig ?? {};
    const normalizedConfig = normalizeAukletConfig(rawConfig);
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

    if (normalizedConfig.modules) {
      outputs.push(...new ModuleStyleOutputWriter(writerOptions).write());
    }

    return {
      packageRoot: context.packageRoot,
      styleFiles: packageContext.styleFiles,
      outputs: outputs.map((file) => ({
        file,
        size: fs.statSync(file).size,
      })),
    };
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
