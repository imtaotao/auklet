import path from 'node:path';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import {
  type FormatWriterOptions,
  toRelativeImportSpecifier,
  writeStyleFile,
} from '#auklet/css/production/format/shared';
import { toOutputStylePath } from '#auklet/css/core/style/specifier';

export class ModuleStyleWriter {
  private readonly sourceRoot: string;
  private readonly config: ModuleStyleBuildConfig;
  private readonly packageContext: StylePackageContext;
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.packageContext = options.packageContext;
    this.sourceRoot = options.packageContext.sourceRoot;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  async write(outRoot: string) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.moduleStyleFile,
    );
    const targetDir = path.dirname(target);
    const root = this.styleProcessor.createRoot();

    for (const styleFile of await this.packageContext.getStyleEntryFiles()) {
      const outputStyleFile = path.join(
        outRoot,
        toOutputStylePath(path.relative(this.sourceRoot, styleFile)),
      );
      this.styleProcessor.appendImportRule(
        root,
        toRelativeImportSpecifier(targetDir, outputStyleFile),
      );
    }

    if (!root.nodes?.length) return null;

    writeStyleFile(target, this.styleProcessor.stringify(root));
    return target;
  }
}
