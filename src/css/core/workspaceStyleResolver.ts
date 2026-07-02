import path from 'node:path';
import { createRequire } from 'node:module';
import { NODE_MODULES_DIR } from '#auklet/css/constants';
import { resolvePackageImportsSourceImport } from '#auklet/css/core/resolvers/packageImports';
import { resolveTsconfigPathsSourceImport } from '#auklet/css/core/resolvers/tsconfigPaths';
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
  readonly sourceRoot: string;

  constructor(
    private readonly config: ModuleStyleBuildConfig,
    private readonly context: ResolvedModuleStyleBuildContext,
  ) {
    this.sourceRoot = path.isAbsolute(context.sourceDir)
      ? context.sourceDir
      : path.join(context.packageRoot, context.sourceDir);
    this.require = createRequire(
      path.join(this.context.packageRoot, 'package.json'),
    );
  }

  resolveStyleDependency(
    specifier: string,
    fromDir = this.context.packageRoot,
  ) {
    const sourceStyleDependency = this.resolveSourceStyleDependency(
      specifier,
      fromDir,
    );
    if (sourceStyleDependency) return sourceStyleDependency;

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

  resolveSourceStyleDependency(
    specifier: string,
    fromDir = this.context.packageRoot,
  ) {
    if (specifier.startsWith('.')) {
      return path.resolve(fromDir, specifier);
    }

    for (const sourceRelativePath of this.resolveSourceImportPaths(specifier)) {
      const file = path.join(this.sourceRoot, sourceRelativePath);
      if (this.isStyleFile(file)) return file;
    }
    return null;
  }

  isInsideSourceRoot(file: string) {
    const relative = path.relative(this.sourceRoot, file);
    return (
      Boolean(relative) &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    );
  }

  isStyleFile(file: string) {
    return this.config.styleExtensions.includes(path.extname(file));
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

  private resolveSourceImportPaths(specifier: string) {
    return [
      ...resolvePackageImportsSourceImport(
        this.context.packageRoot,
        this.sourceRoot,
        specifier,
      ),
      ...resolveTsconfigPathsSourceImport(
        this.context.packageRoot,
        this.sourceRoot,
        specifier,
      ),
    ];
  }
}
