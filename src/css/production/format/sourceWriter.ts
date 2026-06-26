import path from 'node:path';
import {
  type FormatWriterOptions,
  writeStyleFile,
} from '#auklet/css/production/format/shared';
import type { StylePackageContext } from '#auklet/css/core/stylePackageContext';

export class SourceStyleFileWriter {
  private readonly sourceRoot: string;
  private readonly packageContext: StylePackageContext;
  private readonly styleProcessor: StylePackageContext['styleProcessor'];

  constructor(options: FormatWriterOptions) {
    this.sourceRoot = options.packageContext.sourceRoot;
    this.packageContext = options.packageContext;
    this.styleProcessor = options.packageContext.styleProcessor;
  }

  copy(files: Array<string>, outRoot: string) {
    for (const sourceFile of files) {
      const relative = path.relative(this.sourceRoot, sourceFile);
      const target = path.join(outRoot, relative);
      const content = this.styleProcessor.readStyleFile(sourceFile, undefined, {
        shouldExpandImport: (reference) =>
          this.packageContext.shouldInlineSharedStyleImport(reference),
      });
      writeStyleFile(target, content);
    }
  }
}
