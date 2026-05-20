import fs from 'node:fs';
import path from 'node:path';
import type { FormatWriterOptions } from '#auklet/css/production/format/shared';

export class SourceStyleFileWriter {
  private readonly sourceRoot: string;

  constructor(options: FormatWriterOptions) {
    this.sourceRoot = options.packageContext.sourceRoot;
  }

  copy(files: Array<string>, outRoot: string) {
    for (const sourceFile of files) {
      const relative = path.relative(this.sourceRoot, sourceFile);
      const target = path.join(outRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(sourceFile, target);
    }
  }
}
