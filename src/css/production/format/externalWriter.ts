import fs from 'node:fs';
import path from 'node:path';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';
import { createExternalEntryParts } from '#auklet/css/core/style/entries';
import type { FormatWriterOptions } from '#auklet/css/production/format/shared';
import type { ModuleStyleBuildConfig } from '#auklet/types';

export class ExternalStyleWriter {
  private readonly config: ModuleStyleBuildConfig;
  private readonly packageContext: StylePackageContext;
  private readonly resolver: StylePackageContext['resolver'];
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.config = options.config;
    this.packageContext = options.packageContext;
    this.resolver = options.packageContext.resolver;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  write(outRoot: string) {
    const target = path.join(
      outRoot,
      this.config.output.styleDir,
      this.config.output.externalStyleFile,
    );
    const root = this.styleProcessor.createRoot();

    for (const part of createExternalEntryParts(
      this.packageContext.normalizedConfig,
    )) {
      for (const specifier of part.specifiers) {
        this.styleProcessor.appendImportRule(
          root,
          this.resolver.toExternalStyleSpecifier(specifier, outRoot),
        );
      }
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      root.nodes?.length ? this.styleProcessor.stringify(root) : '',
    );
    return target;
  }
}
