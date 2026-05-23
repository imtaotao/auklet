import path from 'node:path';
import { createRequire } from 'node:module';
import { NODE_MODULES_DIR } from '#auklet/css/constants';
import {
  createExternalStyleSpecifier,
  createOutputStyleSpecifier,
} from '#auklet/css/core/style/specifier';
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
    return createOutputStyleSpecifier(specifier, {
      currentOutputFormat: path.basename(outRoot),
      outputFormats: this.config.output.outputFormats,
    });
  }

  toExternalStyleSpecifier(specifier: string, outRoot: string) {
    return createExternalStyleSpecifier(specifier, {
      currentOutputFormat: path.basename(outRoot),
      outputFormats: this.config.output.outputFormats,
      styleDir: this.config.output.styleDir,
      indexStyleFile: this.config.output.indexStyleFile,
      externalStyleFile: this.config.output.externalStyleFile,
    });
  }
}
