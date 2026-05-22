import path from 'node:path';
import type { ModuleStyleBuildConfig } from '#auklet/types';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import {
  type FormatWriterOptions,
  writeStyleFile,
} from '#auklet/css/production/format/shared';

export class ModuleStyleWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly packageContext: StylePackageContext;
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.packageContext = options.packageContext;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  write(outRoot: string) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.moduleStyleFile,
    );
    const seen = new Set<string>();
    const root = this.styleProcessor.createRoot();

    for (const styleFile of this.packageContext.styleFiles) {
      const content = this.styleProcessor.readStyleFile(styleFile, seen);
      if (content.trim()) {
        this.styleProcessor.appendStyleContent(root, content, styleFile);
      }
    }

    if (!root.nodes?.length) return null;

    writeStyleFile(target, this.styleProcessor.stringify(root));
    return target;
  }
}
